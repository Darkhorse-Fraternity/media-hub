import { createHash } from "node:crypto";

import { and, desc, eq, inArray } from "@acme/db";
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

import type { VideoScriptTransition } from "./video-script-renderer";
import { deliverGenerationResultNotification } from "./generation-notification";
import { validateGeneratedVideoOutput } from "./generation-output-validation";
import { selectLatestScriptShotJobs } from "./video-script-assembly-core";
import { renderShotVideos } from "./video-script-renderer";

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

function assemblyJobId(scriptId: string, sourceJobIds: string[]): string {
  const digest = createHash("sha256")
    .update(`${scriptId}:${sourceJobIds.join(":")}`)
    .digest("hex")
    .slice(0, 32);
  return `assembly_${digest}`;
}

export async function assembleCompletedVideoScript(input: {
  scriptId: string;
  userId: string;
  requireReady?: boolean;
  sourceJobIds?: string[];
  transition?: VideoScriptTransition;
  rebuild?: boolean;
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
  if (
    !input.sourceJobIds &&
    jobs.some(
      (job) =>
        job.kind !== "assemble" &&
        Boolean(job.scriptShotId) &&
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
  const sourceJobs = input.sourceJobIds
    ? await db.query.mediaGenerationJob.findMany({
        where: and(
          inArray(mediaGenerationJob.id, input.sourceJobIds),
          eq(mediaGenerationJob.createdBy, input.userId),
        ),
      })
    : selectLatestScriptShotJobs(
        script.shots.map((shot) => shot.id),
        jobs,
      );
  if (input.sourceJobIds) {
    const byId = new Map(sourceJobs?.map((job) => [job.id, job]));
    if (
      input.sourceJobIds.length !== script.shots.length ||
      byId.size !== input.sourceJobIds.length ||
      input.sourceJobIds.some((id, index) => {
        const job = byId.get(id);
        return (
          !job ||
          job.status !== "succeeded" ||
          job.kind === "assemble" ||
          !job.outputStorageKey ||
          (job.scriptId && job.scriptId !== script.id) ||
          (job.scriptShotId && job.scriptShotId !== script.shots[index]?.id) ||
          job.width !== script.width ||
          job.height !== script.height ||
          job.fps !== sourceJobs?.[0]?.fps ||
          job.durationSeconds !== script.shots[index]?.durationSeconds
        );
      })
    ) {
      throw new VideoScriptAssemblyNotReadyError(
        "镜头视频数量、顺序、归属或参数与脚本不匹配",
      );
    }
  }
  if (!sourceJobs || sourceJobs.length === 0) {
    if (input.requireReady) {
      throw new VideoScriptAssemblyNotReadyError(
        "每个镜头都需要一条最新的成功视频",
      );
    }
    return null;
  }
  const orderedSourceJobs = input.sourceJobIds
    ? input.sourceJobIds.map((id) => sourceJobs.find((job) => job.id === id)!)
    : sourceJobs;
  const sourceJobIds = orderedSourceJobs.map((job) => job.id);
  const jobId = assemblyJobId(script.id, sourceJobIds);
  const existing = jobs.find((job) => job.id === jobId);
  const totalDurationSeconds = script.shots.reduce(
    (total, shot) => total + shot.durationSeconds,
    0,
  );
  const transition = input.transition ?? "cut";
  const workflowVersion =
    transition === "cut"
      ? "script-concat-copy-v1"
      : `script-crossfade-${transition}-v2`;
  if (existing?.status === "succeeded") {
    if (input.rebuild) {
      if (!existing.mediaTaskId || !existing.outputStorageKey) {
        throw new VideoScriptAssemblyNotReadyError("成片缺少发布草稿或原视频");
      }
      const oldStorageKey = existing.outputStorageKey;
      const newStorageKey = `media-hub/scripts/${input.userId}/${script.id}/${jobId}-${crypto.randomUUID()}.mp4`;
      let uploaded = false;
      try {
        const video = await renderShotVideos(
          await Promise.all(
            orderedSourceJobs.map((job) =>
              getMediaHubObject(job.outputStorageKey!),
            ),
          ),
          transition,
          orderedSourceJobs[0]?.fps ?? 24,
        );
        await validateGeneratedVideoOutput(video, {
          durationSeconds: totalDurationSeconds,
          width: script.width,
          height: script.height,
          fps: orderedSourceJobs[0]?.fps ?? 24,
        });
        await putMediaHubObject(newStorageKey, video, "video/mp4");
        uploaded = true;
        const finishedAt = new Date();
        await db.transaction(async (transaction) => {
          const task = await transaction.query.mediaTask.findFirst({
            where: eq(mediaTask.id, existing.mediaTaskId!),
          });
          const target = await transaction.query.mediaPublishTarget.findFirst({
            where: eq(mediaPublishTarget.taskId, existing.mediaTaskId!),
          });
          if (!task || task.status !== "draft" || target) {
            throw new VideoScriptAssemblyNotReadyError(
              "成片已进入发布流程，不能原位替换视频",
            );
          }
          await transaction
            .update(mediaTask)
            .set({
              videoStorageKey: newStorageKey,
              aiPrompts: {
                source: "video-script",
                scriptId: script.id,
                scriptVersion: script.version,
                sourceGenerationJobIds: sourceJobIds,
                workflowVersion,
              },
              updatedAt: finishedAt,
            })
            .where(eq(mediaTask.id, task.id));
          const [updated] = await transaction
            .update(mediaGenerationJob)
            .set({
              outputStorageKey: newStorageKey,
              workflowVersion,
              finishedAt,
              updatedAt: finishedAt,
            })
            .where(
              and(
                eq(mediaGenerationJob.id, jobId),
                eq(mediaGenerationJob.status, "succeeded"),
                eq(mediaGenerationJob.outputStorageKey, oldStorageKey),
              ),
            )
            .returning({ id: mediaGenerationJob.id });
          if (!updated) {
            throw new VideoScriptAssemblyNotReadyError(
              "成片在重建期间发生变化，请重试",
            );
          }
        });
      } catch (error) {
        if (uploaded) {
          await deleteMediaHubObject(newStorageKey).catch(() => undefined);
        }
        throw error;
      }
      await deleteMediaHubObject(oldStorageKey).catch(() => undefined);
    }
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
    fps: orderedSourceJobs[0]?.fps ?? 24,
    width: script.width,
    height: script.height,
    qualityPreset: "assembled",
    steps: 0,
    profile: "script-concat-v1",
    workflowVersion,
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
    const video = await renderShotVideos(
      await Promise.all(
        orderedSourceJobs.map((job) =>
          getMediaHubObject(job.outputStorageKey!),
        ),
      ),
      transition,
      orderedSourceJobs[0]?.fps ?? 24,
    );
    await validateGeneratedVideoOutput(video, {
      durationSeconds: totalDurationSeconds,
      width: script.width,
      height: script.height,
      fps: orderedSourceJobs[0]?.fps ?? 24,
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
          workflowVersion,
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
      if (input.sourceJobIds) {
        for (const [index, sourceJob] of orderedSourceJobs.entries()) {
          await transaction
            .update(mediaGenerationJob)
            .set({
              scriptId: script.id,
              scriptShotId: script.shots[index]!.id,
              updatedAt: finishedAt,
            })
            .where(eq(mediaGenerationJob.id, sourceJob.id));
        }
      }
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
