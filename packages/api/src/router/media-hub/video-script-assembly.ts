import { and, desc, eq, inArray, isNull, or } from "@acme/db";
import { db } from "@acme/db/client";
import {
  mediaGenerationJob,
  mediaPublishTarget,
  mediaTask,
  mediaVideoScript,
} from "@acme/db/schema";
import { log } from "@acme/logger";
import {
  deleteMediaHubObject,
  getMediaHubObject,
  putMediaHubObject,
} from "@acme/storage";

import type { MediaHubDb } from "./video-script-document";
import type { VideoScriptTransition } from "./video-script-renderer";
import { deliverGenerationResultNotification } from "./generation-notification";
import { validateGeneratedVideoOutput } from "./generation-output-validation";
import {
  scriptAssemblyJobId,
  selectLatestScriptShotJobs,
} from "./video-script-assembly-core";
import { captionsToSrt, shotTrim } from "./video-script-edit-plan";
import { renderScriptCut } from "./video-script-render";
import { withScriptRenderSlot } from "./video-script-render-queue";
import { TRANSITION_SECONDS } from "./video-script-renderer";

const ABANDONED_RENDER_MS = 10 * 60_000;
class AssemblyStoppedError extends Error {}

const ACTIVE_STATUSES = new Set([
  "scheduled",
  "queued",
  "waiting_for_gpu",
  "running",
]);

export class VideoScriptAssemblyNotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VideoScriptAssemblyNotReadyError";
  }
}

export async function assembleCompletedVideoScript(
  input: {
    scriptId: string;
    userId: string;
    requireReady?: boolean;
    burnCaptions?: boolean;
    sourceJobIds?: string[];
    transition?: VideoScriptTransition;
    rebuild?: boolean;
  },
  database: MediaHubDb = db,
): Promise<{
  jobId: string;
  mediaTaskId: string | null;
  status: string;
  sourceJobIds: string[];
} | null> {
  const script = await database.query.mediaVideoScript.findFirst({
    where: and(
      eq(mediaVideoScript.id, input.scriptId),
      eq(mediaVideoScript.createdBy, input.userId),
    ),
  });
  if (!script || script.deletedAt) {
    if (input.requireReady) {
      throw new VideoScriptAssemblyNotReadyError("视频脚本不存在");
    }
    return null;
  }
  const jobs = await database.query.mediaGenerationJob.findMany({
    where: and(
      eq(mediaGenerationJob.scriptId, script.id),
      eq(mediaGenerationJob.createdBy, input.userId),
    ),
    orderBy: desc(mediaGenerationJob.createdAt),
  });
  const selectedJobIds = Object.fromEntries(
    script.shots.flatMap((shot) =>
      shot.selectedGenerationJobId
        ? [[shot.id, shot.selectedGenerationJobId] as const]
        : [],
    ),
  );
  if (
    !input.sourceJobIds &&
    jobs.some(
      (job) =>
        job.kind !== "assemble" &&
        job.scriptShotId !== null &&
        script.shots.some((shot) => shot.id === job.scriptShotId) &&
        !selectedJobIds[job.scriptShotId] &&
        ACTIVE_STATUSES.has(job.status),
    )
  ) {
    if (input.requireReady) {
      throw new VideoScriptAssemblyNotReadyError(
        "仍有镜头正在生成，请完成后再合成",
      );
    }
    return null;
  }
  let sourceJobs = selectLatestScriptShotJobs(
    script.shots.map((shot) => shot.id),
    jobs,
    selectedJobIds,
  );
  if (input.sourceJobIds) {
    const candidates = await database.query.mediaGenerationJob.findMany({
      where: and(
        inArray(mediaGenerationJob.id, input.sourceJobIds),
        eq(mediaGenerationJob.createdBy, input.userId),
      ),
    });
    const byId = new Map(candidates.map((job) => [job.id, job]));
    if (
      input.sourceJobIds.length !== script.shots.length ||
      byId.size !== input.sourceJobIds.length ||
      input.sourceJobIds.some((id, index) => {
        const job = byId.get(id);
        const shot = script.shots[index];
        return (
          !job ||
          !shot ||
          job.status !== "succeeded" ||
          job.kind === "assemble" ||
          !job.outputStorageKey ||
          (job.scriptId ?? script.id) !== script.id ||
          (job.scriptShotId ?? shot.id) !== shot.id ||
          job.width !== script.width ||
          job.height !== script.height ||
          job.fps !== candidates[0]?.fps ||
          job.durationSeconds !== shot.durationSeconds
        );
      })
    )
      throw new VideoScriptAssemblyNotReadyError(
        "镜头视频数量、顺序、归属或参数与脚本不匹配",
      );
    sourceJobs = input.sourceJobIds.map((id) => {
      const job = byId.get(id);
      if (!job) throw new VideoScriptAssemblyNotReadyError("镜头视频不存在");
      return job;
    });
  }
  if (!sourceJobs || sourceJobs.length === 0) {
    if (input.requireReady) {
      throw new VideoScriptAssemblyNotReadyError(
        "每个镜头都需要一条最新的成功视频",
      );
    }
    return null;
  }
  const sourceJobIds = sourceJobs.map((job) => job.id);
  const hasTrim = script.shots.some((shot) => {
    const trim = shotTrim(shot);
    return trim.start !== 0 || trim.end !== shot.durationSeconds;
  });
  const burnCaptions = input.burnCaptions ?? false;
  if (burnCaptions && !captionsToSrt(script.shots).trim()) {
    throw new VideoScriptAssemblyNotReadyError(
      "请先为至少一个镜头生成或填写字幕",
    );
  }
  const customRender = hasTrim || burnCaptions;
  const jobId = scriptAssemblyJobId(
    script.id,
    sourceJobIds,
    script.shots,
    burnCaptions,
    { width: script.width, height: script.height },
  );
  const existing = jobs.find((job) => job.id === jobId);
  const rebuilding = existing?.status === "succeeded" && Boolean(input.rebuild);
  const requireDraft = async (
    transaction: Parameters<Parameters<MediaHubDb["transaction"]>[0]>[0],
  ) => {
    if (!existing?.mediaTaskId || !existing.outputStorageKey)
      throw new VideoScriptAssemblyNotReadyError("成片缺少发布草稿或原视频");
    const [task] = await transaction
      .select()
      .from(mediaTask)
      .where(
        and(
          eq(mediaTask.id, existing.mediaTaskId),
          eq(mediaTask.createdBy, input.userId),
        ),
      )
      .for("update");
    const target = await transaction.query.mediaPublishTarget.findFirst({
      where: eq(mediaPublishTarget.taskId, existing.mediaTaskId),
    });
    if (task?.status !== "draft" || target)
      throw new VideoScriptAssemblyNotReadyError(
        "成片已进入发布流程，不能原位替换视频",
      );
    return task;
  };
  if (rebuilding) await database.transaction(requireDraft);
  if (existing?.status === "succeeded" && !rebuilding) {
    await database.transaction(async (transaction) => {
      await transaction
        .update(mediaGenerationJob)
        .set({ updatedAt: new Date() })
        .where(eq(mediaGenerationJob.id, existing.id));
      await transaction
        .update(mediaVideoScript)
        .set({ status: "completed", updatedAt: new Date() })
        .where(
          and(
            eq(mediaVideoScript.id, script.id),
            eq(mediaVideoScript.version, script.version),
            isNull(mediaVideoScript.deletedAt),
          ),
        );
    });
    return {
      jobId,
      mediaTaskId: existing.mediaTaskId,
      status: existing.status,
      sourceJobIds,
    };
  }
  if (
    existing?.status === "running" &&
    existing.startedAt &&
    Date.now() - existing.startedAt.getTime() < ABANDONED_RENDER_MS
  ) {
    return {
      jobId,
      mediaTaskId: existing.mediaTaskId,
      status: existing.status,
      sourceJobIds,
    };
  }

  const now = new Date();
  const transition = input.transition ?? "cut";
  const totalDurationSeconds =
    script.shots.reduce((total, shot) => total + shotTrim(shot).duration, 0) -
    (transition === "cut" ? 0 : TRANSITION_SECONDS * (script.shots.length - 1));
  const baseJob = {
    scriptId: script.id,
    scriptShotId: null,
    kind: "assemble",
    providerJobIds: sourceJobIds,
    prompt: script.copy || script.brief,
    title: `${script.title} / 完整成片`.slice(0, 200),
    language: script.language,
    referenceImages: [],
    inputImageAssetIds: [],
    durationSeconds: Math.ceil(totalDurationSeconds),
    fps: 24,
    width: script.width,
    height: script.height,
    qualityPreset: "assembled",
    steps: 0,
    profile: customRender ? "script-cut-v2" : "script-concat-v1",
    workflowVersion:
      transition !== "cut"
        ? `script-crossfade-${transition}-v3`
        : burnCaptions
          ? "script-cut-captioned-v3"
          : customRender
            ? "script-cut-v3"
            : "script-concat-v3",
    status: "running",
    createdBy: input.userId,
    startedAt: now,
    updatedAt: now,
  } satisfies Partial<typeof mediaGenerationJob.$inferInsert>;

  let claimed = false;
  if (
    existing &&
    (rebuilding || ["failed", "canceled", "running"].includes(existing.status))
  ) {
    const [updated] = await database
      .update(mediaGenerationJob)
      .set({
        ...baseJob,
        errorMessage: null,
        errorCode: null,
        failureStage: null,
        errorRetryable: null,
        finishedAt: null,
        outputStorageKey: rebuilding ? existing.outputStorageKey : null,
        mediaTaskId: rebuilding ? existing.mediaTaskId : null,
      })
      .where(
        and(
          eq(mediaGenerationJob.id, jobId),
          eq(mediaGenerationJob.status, existing.status),
          existing.startedAt
            ? eq(mediaGenerationJob.startedAt, existing.startedAt)
            : isNull(mediaGenerationJob.startedAt),
        ),
      )
      .returning({ id: mediaGenerationJob.id });
    claimed = Boolean(updated);
  } else {
    const [inserted] = await database
      .insert(mediaGenerationJob)
      .values({ id: jobId, ...baseJob, createdAt: now })
      .onConflictDoNothing()
      .returning({ id: mediaGenerationJob.id });
    claimed = Boolean(inserted);
  }
  if (!claimed) {
    const current = await database.query.mediaGenerationJob.findFirst({
      where: eq(mediaGenerationJob.id, jobId),
    });
    return current
      ? {
          jobId,
          mediaTaskId: current.mediaTaskId,
          status: current.status,
          sourceJobIds,
        }
      : null;
  }

  await database
    .update(mediaVideoScript)
    .set({ status: "assembling", updatedAt: now })
    .where(
      and(
        eq(mediaVideoScript.id, script.id),
        eq(mediaVideoScript.version, script.version),
        isNull(mediaVideoScript.deletedAt),
      ),
    );

  const storageKey = `media-hub/scripts/${input.userId}/${script.id}/${jobId}/${crypto.randomUUID()}.mp4`;
  const attemptWhere = and(
    eq(mediaGenerationJob.id, jobId),
    eq(mediaGenerationJob.status, "running"),
    eq(mediaGenerationJob.startedAt, now),
  );
  const assertCurrent = async () => {
    const [currentJob, currentScript] = await Promise.all([
      database.query.mediaGenerationJob.findFirst({
        where: eq(mediaGenerationJob.id, jobId),
      }),
      database.query.mediaVideoScript.findFirst({
        where: eq(mediaVideoScript.id, script.id),
      }),
    ]);
    if (
      currentJob?.status !== "running" ||
      currentJob.startedAt?.getTime() !== now.getTime() ||
      !currentScript ||
      currentScript.deletedAt ||
      currentScript.version !== script.version
    ) {
      throw new AssemblyStoppedError("合片已取消或脚本已更新，请重新合成");
    }
  };
  try {
    const video = await withScriptRenderSlot(async (signal) => {
      await assertCurrent();
      const controller = new AbortController();
      const poll = setInterval(() => {
        void assertCurrent().catch((error: unknown) => controller.abort(error));
      }, 1000);
      poll.unref();
      try {
        const renderSignal = AbortSignal.any([signal, controller.signal]);
        return await renderScriptCut(
          sourceJobs.map((job) => () => {
            if (!job.outputStorageKey) throw new Error("镜头视频文件不可用");
            return getMediaHubObject(job.outputStorageKey, renderSignal);
          }),
          script.shots,
          burnCaptions,
          renderSignal,
          { width: script.width, height: script.height },
          transition,
        );
      } finally {
        clearInterval(poll);
      }
    });
    await assertCurrent();
    await validateGeneratedVideoOutput(video, {
      durationSeconds: totalDurationSeconds,
      width: script.width,
      height: script.height,
      fps: 24,
    });
    await assertCurrent();
    await putMediaHubObject(
      storageKey,
      video,
      "video/mp4",
      AbortSignal.timeout(120_000),
    );
    const finishedAt = new Date();
    const mediaTaskId =
      rebuilding && existing.mediaTaskId
        ? existing.mediaTaskId
        : crypto.randomUUID();
    await database.transaction(async (transaction) => {
      const [currentScript] = await transaction
        .update(mediaVideoScript)
        .set({ status: "completed", updatedAt: finishedAt })
        .where(
          and(
            eq(mediaVideoScript.id, script.id),
            eq(mediaVideoScript.version, script.version),
            isNull(mediaVideoScript.deletedAt),
          ),
        )
        .returning({ id: mediaVideoScript.id });
      if (!currentScript)
        throw new AssemblyStoppedError("合片期间脚本已更新或删除");
      const taskValues = {
        id: mediaTaskId,
        title: script.title,
        description: script.copy || script.brief,
        language: script.language,
        videoStorageKey: storageKey,
        aiPrompts: {
          source: "video-script",
          scriptId: script.id,
          scriptVersion: script.version,
          sourceGenerationJobIds: sourceJobIds,
          workflowVersion: baseJob.workflowVersion,
          burnCaptions,
          transition,
        },
        status: "draft",
        createdBy: input.userId,
        createdAt: finishedAt,
        updatedAt: finishedAt,
      } satisfies typeof mediaTask.$inferInsert;
      if (rebuilding) {
        await requireDraft(transaction);
        await transaction
          .update(mediaTask)
          .set({
            videoStorageKey: storageKey,
            aiPrompts: taskValues.aiPrompts,
            updatedAt: finishedAt,
          })
          .where(eq(mediaTask.id, mediaTaskId));
      } else {
        await transaction.insert(mediaTask).values(taskValues);
      }
      const [completedJob] = await transaction
        .update(mediaGenerationJob)
        .set({
          status: "succeeded",
          outputStorageKey: storageKey,
          mediaTaskId,
          notificationStatus: "pending",
          notificationAttempts: 0,
          notificationError: null,
          notificationNextAttemptAt: null,
          notificationDeliveredAt: null,
          finishedAt,
          updatedAt: finishedAt,
        })
        .where(attemptWhere)
        .returning({ id: mediaGenerationJob.id });
      if (!completedJob) throw new AssemblyStoppedError("合片任务已取消");
      if (input.sourceJobIds) {
        for (const [index, sourceJob] of sourceJobs.entries()) {
          const shot = script.shots[index];
          if (!shot) throw new AssemblyStoppedError("镜头不存在");
          const [attached] = await transaction
            .update(mediaGenerationJob)
            .set({
              scriptId: script.id,
              scriptShotId: shot.id,
              updatedAt: finishedAt,
            })
            .where(
              and(
                eq(mediaGenerationJob.id, sourceJob.id),
                eq(mediaGenerationJob.createdBy, input.userId),
                or(
                  isNull(mediaGenerationJob.scriptId),
                  eq(mediaGenerationJob.scriptId, script.id),
                ),
                or(
                  isNull(mediaGenerationJob.scriptShotId),
                  eq(mediaGenerationJob.scriptShotId, shot.id),
                ),
              ),
            )
            .returning({ id: mediaGenerationJob.id });
          if (!attached)
            throw new AssemblyStoppedError("镜头视频归属在合片期间发生变化");
        }
      }
    });
    if (rebuilding && existing.outputStorageKey)
      await deleteMediaHubObject(existing.outputStorageKey).catch(
        () => undefined,
      );

    await deliverGenerationResultNotification(jobId).catch((error: unknown) => {
      log.error("Video script assembly notification failed", {
        code: "VIDEO_SCRIPT_ASSEMBLY_NOTIFICATION_FAILED",
        script_id: script.id,
        job_id: jobId,
        err: error instanceof Error ? error : new Error(String(error)),
      });
    });
    return { jobId, mediaTaskId, status: "succeeded", sourceJobIds };
  } catch (error) {
    await deleteMediaHubObject(storageKey).catch(() => undefined);
    const finishedAt = new Date();
    // AbortError wraps its signal reason; the database remains the cancellation authority.
    const current = await database.query.mediaGenerationJob.findFirst({
      where: eq(mediaGenerationJob.id, jobId),
    });
    const stopped =
      error instanceof AssemblyStoppedError || current?.status === "canceled";
    const message = error instanceof Error ? error.message : String(error);
    await database.transaction(async (transaction) => {
      const [failedJob] = await transaction
        .update(mediaGenerationJob)
        .set({
          status: rebuilding ? "succeeded" : stopped ? "canceled" : "failed",
          errorMessage: message.slice(0, 1000),
          errorCode: "script_assembly_failed",
          failureStage: "assembly",
          errorRetryable: true,
          ...(rebuilding
            ? {
                outputStorageKey: existing.outputStorageKey,
                mediaTaskId: existing.mediaTaskId,
                durationSeconds: existing.durationSeconds,
                fps: existing.fps,
                profile: existing.profile,
                workflowVersion: existing.workflowVersion,
                startedAt: existing.startedAt,
              }
            : {}),
          finishedAt: rebuilding ? existing.finishedAt : finishedAt,
          updatedAt: finishedAt,
        })
        .where(attemptWhere)
        .returning({ id: mediaGenerationJob.id });
      if (
        failedJob ||
        (current?.status === "canceled" &&
          current.startedAt?.getTime() === now.getTime())
      )
        await transaction
          .update(mediaVideoScript)
          .set({
            status: rebuilding
              ? "completed"
              : stopped
                ? "ready"
                : "assembly_failed",
            updatedAt: finishedAt,
          })
          .where(
            and(
              eq(mediaVideoScript.id, script.id),
              eq(mediaVideoScript.version, script.version),
              eq(mediaVideoScript.status, "assembling"),
              isNull(mediaVideoScript.deletedAt),
            ),
          );
    });
    if (stopped)
      return { jobId, mediaTaskId: null, status: "canceled", sourceJobIds };
    throw error;
  }
}

export async function maybeAssembleCompletedVideoScript(
  scriptId: string,
  userId: string,
): Promise<void> {
  try {
    await assembleCompletedVideoScript({ scriptId, userId });
  } catch (error) {
    log.error("Automatic video script assembly failed", {
      code: "VIDEO_SCRIPT_AUTO_ASSEMBLY_FAILED",
      script_id: scriptId,
      err: error instanceof Error ? error : new Error(String(error)),
    });
  }
}
