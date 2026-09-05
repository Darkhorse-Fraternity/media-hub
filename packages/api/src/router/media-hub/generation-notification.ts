import { and, asc, eq, inArray, isNull, lt, lte, or, sql } from "@acme/db";
import { db } from "@acme/db/client";
import {
  mediaGenerationJob,
  mediaUserPreference,
  user as User,
} from "@acme/db/schema";
import { log } from "@acme/logger";
import { getMediaHubObject } from "@acme/storage";

import {
  prepareFeishuNotificationVideo,
  sendGenerationResultCard,
} from "./feishu-notify";
import { generationNotificationRetryDelayMs } from "./generation-notification-core";

const NOTIFICATION_SWEEP_INTERVAL_MS = 30_000;
const NOTIFICATION_STALE_AFTER_MS = 2 * 60_000;
const NOTIFICATION_MAX_ATTEMPTS = 8;
let notificationSchedulerStarted = false;

export async function deliverGenerationResultNotification(
  jobId: string,
): Promise<"delivered" | "disabled" | "deferred" | "ignored"> {
  const now = new Date();
  const [job] = await db
    .update(mediaGenerationJob)
    .set({
      notificationStatus: "sending",
      notificationAttempts: sql`${mediaGenerationJob.notificationAttempts} + 1`,
      notificationError: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(mediaGenerationJob.id, jobId),
        inArray(mediaGenerationJob.status, ["succeeded", "failed"]),
        inArray(mediaGenerationJob.notificationStatus, ["pending", "failed"]),
        or(
          isNull(mediaGenerationJob.notificationNextAttemptAt),
          lte(mediaGenerationJob.notificationNextAttemptAt, now),
        ),
      ),
    )
    .returning();
  if (!job) return "ignored";

  try {
    const [creator, recipientPreference] = await Promise.all([
      db.query.user.findFirst({
        where: eq(User.id, job.createdBy),
        columns: { name: true, email: true },
      }),
      db.query.mediaUserPreference.findFirst({
        where: eq(mediaUserPreference.userId, job.createdBy),
        columns: { feishuWebhookUrl: true, feishuChatId: true },
      }),
    ]);
    const recipientWebhookUrl = recipientPreference?.feishuWebhookUrl?.trim();
    const recipientChatId = recipientPreference?.feishuChatId?.trim();
    if (!recipientWebhookUrl && !recipientChatId) {
      await db
        .update(mediaGenerationJob)
        .set({
          notificationStatus: "disabled",
          notificationError: null,
          notificationNextAttemptAt: null,
          updatedAt: new Date(),
        })
        .where(eq(mediaGenerationJob.id, job.id));
      log.info("Generation notification disabled for user", {
        code: "MEDIA_GENERATION_NOTIFICATION_DISABLED",
        job_id: job.id,
        owner_user_id: job.createdBy,
      });
      return "disabled";
    }

    const appUrl = process.env.APP_URL?.replace(/\/$/, "");
    const storedVideo =
      job.status === "succeeded" && recipientChatId && job.outputStorageKey
        ? await getMediaHubObject(job.outputStorageKey)
        : undefined;
    const video = storedVideo
      ? await prepareFeishuNotificationVideo(storedVideo)
      : undefined;
    await sendGenerationResultCard({
      jobId: job.id,
      title: job.title,
      prompt: job.prompt,
      status: job.status as "succeeded" | "failed",
      operation:
        job.kind === "edit"
          ? "edit"
          : job.kind === "assemble"
            ? "assemble"
            : "generate",
      editSegmentCount: job.editSegments.length,
      durationSeconds: job.durationSeconds,
      language: job.language,
      elapsedSeconds:
        job.startedAt && job.finishedAt
          ? (job.finishedAt.getTime() - job.startedAt.getTime()) / 1000
          : 0,
      fps: job.fps,
      width: job.width,
      height: job.height,
      qualityPreset: job.qualityPreset,
      steps: job.steps,
      seed: job.seed,
      profile: job.profile,
      modelVersion: job.modelVersion,
      workflowVersion: job.workflowVersion,
      referenceImageCount:
        job.referenceImages.length +
        job.editSegments.reduce(
          (total, segment) => total + segment.referenceImages.length,
          0,
        ),
      hasFirstFrame: Boolean(job.sourceImageStorageKey),
      scheduledAt: job.scheduledAt,
      providerJobId:
        job.providerJobIds.length > 0
          ? job.providerJobIds.join(", ")
          : job.providerJobId,
      createdByLabel: creator
        ? `${creator.name} (${creator.email})`
        : job.createdBy,
      errorMessage: job.errorMessage,
      errorCode: job.errorCode,
      failureStage: job.failureStage,
      errorRetryable: job.errorRetryable,
      video,
      videoBytes: video?.length,
      videoUrl:
        job.status === "succeeded" && appUrl
          ? `${appUrl}/#generation-job-${job.id}`
          : undefined,
      recipientWebhookUrl,
      recipientChatId,
    });
    const deliveredAt = new Date();
    await db
      .update(mediaGenerationJob)
      .set({
        notificationStatus: "delivered",
        notificationError: null,
        notificationNextAttemptAt: null,
        notificationDeliveredAt: deliveredAt,
        updatedAt: deliveredAt,
      })
      .where(eq(mediaGenerationJob.id, job.id));
    log.info("Generation notification delivered", {
      code: "MEDIA_GENERATION_NOTIFICATION_DELIVERED",
      job_id: job.id,
      owner_user_id: job.createdBy,
      attempt: job.notificationAttempts,
    });
    return "delivered";
  } catch (error) {
    const notificationError =
      error instanceof Error ? error : new Error(String(error));
    const exhausted = job.notificationAttempts >= NOTIFICATION_MAX_ATTEMPTS;
    const retryAt = exhausted
      ? null
      : new Date(
          Date.now() +
            generationNotificationRetryDelayMs(job.notificationAttempts),
        );
    await db
      .update(mediaGenerationJob)
      .set({
        notificationStatus: "failed",
        notificationError: notificationError.message.slice(0, 1000),
        notificationNextAttemptAt: retryAt,
        updatedAt: new Date(),
      })
      .where(eq(mediaGenerationJob.id, job.id));
    log.error("Generation notification delivery failed", {
      code: "MEDIA_GENERATION_NOTIFICATION_FAILED",
      job_id: job.id,
      owner_user_id: job.createdBy,
      attempt: job.notificationAttempts,
      retry_at: retryAt?.toISOString() ?? null,
      err: notificationError,
    });
    return "deferred";
  }
}

export async function resendGenerationResultNotification(
  jobId: string,
): Promise<"delivered" | "disabled" | "deferred" | "ignored"> {
  await db
    .update(mediaGenerationJob)
    .set({
      notificationStatus: "pending",
      notificationAttempts: 0,
      notificationError: null,
      notificationNextAttemptAt: null,
      notificationDeliveredAt: null,
      updatedAt: new Date(),
    })
    .where(eq(mediaGenerationJob.id, jobId));
  return deliverGenerationResultNotification(jobId);
}

async function runGenerationNotificationSweep(): Promise<void> {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - NOTIFICATION_STALE_AFTER_MS);
  await db
    .update(mediaGenerationJob)
    .set({
      notificationStatus: "failed",
      notificationError: "通知投递进程中断，已自动重新排队",
      notificationNextAttemptAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(mediaGenerationJob.notificationStatus, "sending"),
        lt(mediaGenerationJob.updatedAt, staleBefore),
      ),
    );

  const jobs = await db.query.mediaGenerationJob.findMany({
    where: and(
      inArray(mediaGenerationJob.status, ["succeeded", "failed"]),
      inArray(mediaGenerationJob.notificationStatus, ["pending", "failed"]),
      lt(mediaGenerationJob.notificationAttempts, NOTIFICATION_MAX_ATTEMPTS),
      or(
        isNull(mediaGenerationJob.notificationNextAttemptAt),
        lte(mediaGenerationJob.notificationNextAttemptAt, now),
      ),
    ),
    orderBy: asc(mediaGenerationJob.finishedAt),
    limit: 20,
    columns: { id: true },
  });
  for (const job of jobs) {
    await deliverGenerationResultNotification(job.id);
  }
}

export function startMediaGenerationNotificationScheduler(): void {
  if (notificationSchedulerStarted) return;
  notificationSchedulerStarted = true;
  const sweep = () => {
    void runGenerationNotificationSweep().catch((error: unknown) => {
      log.error("Generation notification scheduler sweep failed", {
        code: "MEDIA_GENERATION_NOTIFICATION_SWEEP_FAILED",
        err: error instanceof Error ? error : new Error(String(error)),
      });
    });
  };
  sweep();
  const interval = setInterval(sweep, NOTIFICATION_SWEEP_INTERVAL_MS);
  interval.unref();
}
