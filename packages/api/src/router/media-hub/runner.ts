import { and, eq, inArray } from "@acme/db";
import { db } from "@acme/db/client";
import {
  mediaGenerationJob,
  mediaPlatformAccount,
  mediaPublishTarget,
  mediaTask,
} from "@acme/db/schema";
import { log } from "@acme/logger";
import { getMediaHubObject } from "@acme/storage";

import { sendPublishResultCard } from "./feishu-notify";
import { prepareFeishuVideo } from "./generation";
import {
  isMediaPublishPlanDue,
  readMediaPublishPlans,
} from "./publish-settings";
import { publishToInstagram } from "./publishers/instagram";
import { publishToYouTube } from "./publishers/youtube";

const PUBLISH_SCHEDULER_INTERVAL_MS = 30_000;
let publishSchedulerStarted = false;

/** 单个 target 的发布动作 */
async function runTarget(
  targetId: string,
  options: {
    includeFailed?: boolean;
    ignoreSchedule?: boolean;
    requirePlan?: boolean;
  } = {},
) {
  const target = await db.query.mediaPublishTarget.findFirst({
    where: eq(mediaPublishTarget.id, targetId),
  });
  if (!target) {
    log.warn("Publish target vanished mid-run", {
      code: "MEDIA_TARGET_MISSING",
      target_id: targetId,
    });
    return false;
  }

  const task = await db.query.mediaTask.findFirst({
    where: eq(mediaTask.id, target.taskId),
  });
  if (!task) {
    log.error("Publish target's task missing", {
      code: "MEDIA_TASK_MISSING",
      task_id: target.taskId,
    });
    return false;
  }

  const publishPlan = readMediaPublishPlans(task.aiPrompts)[target.accountId];
  if (options.requirePlan && !publishPlan) return false;
  if (
    !options.ignoreSchedule &&
    publishPlan &&
    !isMediaPublishPlanDue(publishPlan)
  ) {
    return false;
  }

  // 原子抢占 target，避免定时扫描和手动请求重复发布。
  const allowedStatuses = options.includeFailed
    ? ["pending", "failed"]
    : ["pending"];
  const [claimed] = await db
    .update(mediaPublishTarget)
    .set({ status: "publishing", errorMessage: null, updatedAt: new Date() })
    .where(
      and(
        eq(mediaPublishTarget.id, targetId),
        inArray(mediaPublishTarget.status, allowedStatuses),
      ),
    )
    .returning({ id: mediaPublishTarget.id });
  if (!claimed) return false;

  try {
    if (target.platform === "youtube") {
      const result = await publishToYouTube({
        accountId: target.accountId,
        videoStorageKey: task.videoStorageKey,
        title: publishPlan?.title ?? task.title,
        description: target.description ?? task.description,
        hashtags: publishPlan?.hashtags ?? task.hashtags,
        language: publishPlan?.youtube.language ?? task.language,
        privacyStatus: publishPlan?.youtube.privacyStatus ?? "public",
        categoryId: publishPlan?.youtube.categoryId ?? "22",
        madeForKids: publishPlan?.youtube.madeForKids ?? false,
        containsSyntheticMedia:
          publishPlan?.youtube.containsSyntheticMedia ?? true,
        notifySubscribers: publishPlan?.youtube.notifySubscribers ?? true,
      });
      await db
        .update(mediaPublishTarget)
        .set({
          status: "published",
          externalPostId: result.videoId,
          externalUrl: result.url,
          publishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(mediaPublishTarget.id, targetId));
    } else if (target.platform === "instagram") {
      const result = await publishToInstagram({
        accountId: target.accountId,
        videoStorageKey: task.videoStorageKey,
        title: publishPlan?.title ?? task.title,
        description: target.description ?? task.description,
        hashtags: publishPlan?.hashtags ?? task.hashtags,
        shareToFeed: publishPlan?.instagram.shareToFeed ?? true,
        thumbOffsetMs: publishPlan?.instagram.thumbOffsetMs,
      });
      await db
        .update(mediaPublishTarget)
        .set({
          status: "published",
          externalPostId: result.mediaId,
          externalUrl: result.url,
          publishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(mediaPublishTarget.id, targetId));
    } else {
      throw new Error(
        `Platform ${target.platform} publisher not implemented yet`,
      );
    }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    log.error("Publish target failed", {
      code: "MEDIA_PUBLISH_FAILED",
      target_id: targetId,
      platform: target.platform,
      err: error,
    });
    await db
      .update(mediaPublishTarget)
      .set({
        status: "failed",
        errorMessage: error.message.slice(0, 1000),
        retryCount: target.retryCount + 1,
        updatedAt: new Date(),
      })
      .where(eq(mediaPublishTarget.id, targetId));
  }
  return true;
}

/** 聚合所有 target 状态 → 更新 task.status，跑完后推飞书结果卡片 */
async function aggregateTaskStatus(taskId: string) {
  const targets = await db.query.mediaPublishTarget.findMany({
    where: eq(mediaPublishTarget.taskId, taskId),
  });

  const statuses = targets.map((t) => t.status);
  const allPublished = statuses.every((s) => s === "published");
  const anyPublished = statuses.some((s) => s === "published");
  const anyFailed = statuses.some((s) => s === "failed");
  const anyInFlight = statuses.some(
    (s) => s === "pending" || s === "publishing",
  );

  let next: string;
  if (anyInFlight) next = "publishing";
  else if (allPublished) next = "published";
  else if (anyPublished && anyFailed) next = "partial_published";
  else next = "failed";

  await db
    .update(mediaTask)
    .set({ status: next, updatedAt: new Date() })
    .where(eq(mediaTask.id, taskId));

  // 已经跑到终态时推一次结果卡片（publishing 中间态不推）
  if (!anyInFlight) {
    const task = await db.query.mediaTask.findFirst({
      where: eq(mediaTask.id, taskId),
    });
    if (task) {
      const generation = await db.query.mediaGenerationJob.findFirst({
        where: eq(mediaGenerationJob.mediaTaskId, task.id),
      });
      let notificationVideo: Buffer | undefined;
      if (generation) {
        try {
          notificationVideo = await prepareFeishuVideo(
            await getMediaHubObject(task.videoStorageKey),
          );
        } catch (error) {
          log.error("Preparing publish result video for Feishu failed", {
            code: "MEDIA_PUBLISH_RESULT_VIDEO_FAILED",
            task_id: taskId,
            err: error instanceof Error ? error : new Error(String(error)),
          });
        }
      }
      const accountIds = [
        ...new Set(targets.map((target) => target.accountId)),
      ];
      const accounts = accountIds.length
        ? await db.query.mediaPlatformAccount.findMany({
            where: inArray(mediaPlatformAccount.id, accountIds),
            columns: { id: true, accountLabel: true },
          })
        : [];
      const accountLabelById = new Map(
        accounts.map((account) => [account.id, account.accountLabel]),
      );
      try {
        await sendPublishResultCard({
          taskId,
          title: task.title,
          video: notificationVideo,
          videoBytes: notificationVideo?.length,
          durationSeconds: generation?.durationSeconds,
          fps: generation?.fps,
          width: generation?.width,
          height: generation?.height,
          providerJobId: generation?.providerJobId,
          targets: targets.map((t) => ({
            platform: t.platform,
            accountLabel: accountLabelById.get(t.accountId) ?? null,
            status: t.status,
            externalUrl: t.externalUrl,
            errorMessage: t.errorMessage,
          })),
        });
      } catch (err) {
        log.error("sendPublishResultCard failed", {
          code: "MEDIA_FEISHU_RESULT_CARD_FAILED",
          task_id: taskId,
          err: err instanceof Error ? err : new Error(String(err)),
        });
      }
    }
  }
}

/**
 * 运行一个 task 的所有待发布 target（pending 或 failed 的会跑；published 的跳过）。
 * 串行执行：一个 target 出错不影响其他 target。
 *
 * 调用方一般在 review approve 之后 fire-and-forget 触发，不要 await。
 */
export async function runPublishForTask(taskId: string) {
  const task = await db.query.mediaTask.findFirst({
    where: eq(mediaTask.id, taskId),
  });
  if (!task) {
    log.warn("runPublishForTask: task not found", {
      code: "MEDIA_TASK_MISSING",
      task_id: taskId,
    });
    return;
  }
  if (task.status !== "approved" && task.status !== "partial_published") {
    log.warn("runPublishForTask: refusing to run on non-approved status", {
      code: "MEDIA_PUBLISH_BAD_STATUS",
      task_id: taskId,
      status: task.status,
    });
    return;
  }

  // 锁定 task 状态为 publishing
  await db
    .update(mediaTask)
    .set({ status: "publishing", updatedAt: new Date() })
    .where(eq(mediaTask.id, taskId));

  const targets = await db.query.mediaPublishTarget.findMany({
    where: eq(mediaPublishTarget.taskId, taskId),
  });
  const todo = targets.filter(
    (t) => t.status === "pending" || t.status === "failed",
  );

  for (const t of todo) {
    await runTarget(t.id, { includeFailed: true });
  }

  await aggregateTaskStatus(taskId);
}

/**
 * 重试一组指定 target（用户手动 retry 失败 target 时调用）。
 * 不动其他 target 的状态。
 */
export async function runPublishForTargets(targetIds: string[]) {
  if (targetIds.length === 0) return;

  // 取所有相关 task id
  const targets = await db.query.mediaPublishTarget.findMany({
    where: inArray(mediaPublishTarget.id, targetIds),
  });
  const affectedTaskIds = [...new Set(targets.map((t) => t.taskId))];

  // 跑 target
  for (const t of targets) {
    if (t.status === "published") continue; // 已成功的不重试
    await runTarget(t.id, { includeFailed: true, ignoreSchedule: true });
  }

  // 聚合每个受影响 task
  for (const taskId of affectedTaskIds) {
    await aggregateTaskStatus(taskId);
  }
}

async function runDuePublishTargets(): Promise<void> {
  const pendingTargets = await db.query.mediaPublishTarget.findMany({
    where: eq(mediaPublishTarget.status, "pending"),
  });
  const affectedTaskIds = new Set<string>();
  for (const target of pendingTargets) {
    if (await runTarget(target.id, { requirePlan: true })) {
      affectedTaskIds.add(target.taskId);
    }
  }
  for (const taskId of affectedTaskIds) {
    await aggregateTaskStatus(taskId);
  }
}

/** 服务启动后持续扫描到期的发布计划；计划保存在数据库里，重启不会丢失。 */
export function startMediaPublishScheduler(): void {
  if (publishSchedulerStarted) return;
  publishSchedulerStarted = true;

  const sweep = () => {
    void runDuePublishTargets().catch((error: unknown) => {
      log.error("Media publish scheduler sweep failed", {
        code: "MEDIA_PUBLISH_SCHEDULER_FAILED",
        err: error instanceof Error ? error : new Error(String(error)),
      });
    });
  };
  sweep();
  const interval = setInterval(sweep, PUBLISH_SCHEDULER_INTERVAL_MS);
  interval.unref();
}
