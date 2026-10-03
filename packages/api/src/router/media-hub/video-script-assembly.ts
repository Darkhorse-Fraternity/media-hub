import { and, desc, eq } from "@acme/db";
import { db } from "@acme/db/client";
import {
  mediaGenerationJob,
  mediaTask,
  mediaVideoScript,
} from "@acme/db/schema";
import { log } from "@acme/logger";
import {
  deleteMediaHubObject,
  getMediaHubObject,
  putMediaHubObject,
} from "@acme/storage";

import { deliverGenerationResultNotification } from "./generation-notification";
import { validateGeneratedVideoOutput } from "./generation-output-validation";
import {
  scriptAssemblyJobId,
  selectLatestScriptShotJobs,
} from "./video-script-assembly-core";
import { captionsToSrt, shotTrim } from "./video-script-edit-plan";
import { renderScriptCut } from "./video-script-render";

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

export async function assembleCompletedVideoScript(input: {
  scriptId: string;
  userId: string;
  requireReady?: boolean;
  burnCaptions?: boolean;
}): Promise<{
  jobId: string;
  mediaTaskId: string | null;
  status: string;
  sourceJobIds: string[];
} | null> {
  const script = await db.query.mediaVideoScript.findFirst({
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
  const jobs = await db.query.mediaGenerationJob.findMany({
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
    jobs.some(
      (job) =>
        job.kind !== "assemble" &&
        job.scriptShotId !== null &&
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
  const sourceJobs = selectLatestScriptShotJobs(
    script.shots.map((shot) => shot.id),
    jobs,
    selectedJobIds,
  );
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
  );
  const existing = jobs.find((job) => job.id === jobId);
  if (existing?.status === "succeeded") {
    return {
      jobId,
      mediaTaskId: existing.mediaTaskId,
      status: existing.status,
      sourceJobIds,
    };
  }
  if (existing?.status === "running") {
    return {
      jobId,
      mediaTaskId: existing.mediaTaskId,
      status: existing.status,
      sourceJobIds,
    };
  }

  const now = new Date();
  const totalDurationSeconds = script.shots.reduce(
    (total, shot) => total + shotTrim(shot).duration,
    0,
  );
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
    durationSeconds: totalDurationSeconds,
    fps: sourceJobs[0]?.fps ?? 24,
    width: script.width,
    height: script.height,
    qualityPreset: "assembled",
    steps: 0,
    profile: customRender ? "script-cut-v2" : "script-concat-v1",
    workflowVersion: customRender ? "script-cut-v2" : "script-concat-copy-v1",
    status: "running",
    createdBy: input.userId,
    startedAt: now,
    updatedAt: now,
  } satisfies Partial<typeof mediaGenerationJob.$inferInsert>;

  let claimed = false;
  if (existing?.status === "failed") {
    const [updated] = await db
      .update(mediaGenerationJob)
      .set({
        ...baseJob,
        errorMessage: null,
        errorCode: null,
        failureStage: null,
        errorRetryable: null,
        finishedAt: null,
      })
      .where(
        and(
          eq(mediaGenerationJob.id, jobId),
          eq(mediaGenerationJob.status, "failed"),
        ),
      )
      .returning({ id: mediaGenerationJob.id });
    claimed = Boolean(updated);
  } else {
    const [inserted] = await db
      .insert(mediaGenerationJob)
      .values({ id: jobId, ...baseJob, createdAt: now })
      .onConflictDoNothing()
      .returning({ id: mediaGenerationJob.id });
    claimed = Boolean(inserted);
  }
  if (!claimed) {
    const current = await db.query.mediaGenerationJob.findFirst({
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

  await db
    .update(mediaVideoScript)
    .set({ status: "assembling", updatedAt: now })
    .where(eq(mediaVideoScript.id, script.id));

  const storageKey = `media-hub/scripts/${input.userId}/${script.id}/${jobId}.mp4`;
  try {
    const video = await renderScriptCut(
      await Promise.all(
        sourceJobs.map((job) => {
          if (!job.outputStorageKey) throw new Error("镜头视频文件不可用");
          return getMediaHubObject(job.outputStorageKey);
        }),
      ),
      script.shots,
      burnCaptions,
    );
    await validateGeneratedVideoOutput(video, {
      durationSeconds: totalDurationSeconds,
      width: script.width,
      height: script.height,
      fps: sourceJobs[0]?.fps ?? 24,
    });
    await putMediaHubObject(storageKey, video, "video/mp4");
    const finishedAt = new Date();
    const mediaTaskId = crypto.randomUUID();
    await db.transaction(async (transaction) => {
      await transaction.insert(mediaTask).values({
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
          workflowVersion: customRender
            ? "script-cut-v2"
            : "script-concat-copy-v1",
          burnCaptions,
        },
        status: "draft",
        createdBy: input.userId,
        createdAt: finishedAt,
        updatedAt: finishedAt,
      });
      await transaction
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
        .where(eq(mediaGenerationJob.id, jobId));
      await transaction
        .update(mediaVideoScript)
        .set({ status: "completed", updatedAt: finishedAt })
        .where(eq(mediaVideoScript.id, script.id));
    });

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
    const message = error instanceof Error ? error.message : String(error);
    await db.transaction(async (transaction) => {
      await transaction
        .update(mediaGenerationJob)
        .set({
          status: "failed",
          errorMessage: message.slice(0, 1000),
          errorCode: "script_assembly_failed",
          failureStage: "assembly",
          errorRetryable: true,
          finishedAt,
          updatedAt: finishedAt,
        })
        .where(eq(mediaGenerationJob.id, jobId));
      await transaction
        .update(mediaVideoScript)
        .set({ status: "assembly_failed", updatedAt: finishedAt })
        .where(eq(mediaVideoScript.id, script.id));
    });
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
