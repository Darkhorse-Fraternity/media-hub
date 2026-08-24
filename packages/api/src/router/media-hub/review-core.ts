import { eq } from "@acme/db";
import { db } from "@acme/db/client";
import { mediaReviewLog, mediaTask } from "@acme/db/schema";
import { log } from "@acme/logger";

import { runPublishForTask } from "./runner";

interface ReviewInput {
  taskId: string;
  action: "approve" | "reject";
  comment?: string | null;
  /** 必须是 user.id */
  reviewerId: string;
}

interface ReviewResult {
  ok: boolean;
  status?: string;
  error?: string;
}

/**
 * 审核 task 核心逻辑（不依赖 tRPC ctx）。
 * task router 调用这个核心审核逻辑。
 */
export async function reviewMediaTaskCore(
  input: ReviewInput,
): Promise<ReviewResult> {
  const task = await db.query.mediaTask.findFirst({
    where: eq(mediaTask.id, input.taskId),
  });
  if (!task) return { ok: false, error: "task_not_found" };
  if (task.status !== "pending_review") {
    return { ok: false, error: `bad_status:${task.status}` };
  }

  const now = new Date();
  const newStatus = input.action === "approve" ? "approved" : "rejected";

  await db.transaction(async (tx) => {
    await tx
      .update(mediaTask)
      .set({
        status: newStatus,
        reviewedBy: input.reviewerId,
        reviewedAt: now,
        updatedAt: now,
      })
      .where(eq(mediaTask.id, input.taskId));

    await tx.insert(mediaReviewLog).values({
      id: crypto.randomUUID(),
      taskId: input.taskId,
      reviewer: input.reviewerId,
      action: input.action,
      comment: input.comment ?? undefined,
      createdAt: now,
    });
  });

  // approve 后 fire-and-forget 触发发布 worker
  if (input.action === "approve") {
    setImmediate(() => {
      runPublishForTask(input.taskId).catch((err: unknown) => {
        log.error("runPublishForTask failed in review-core", {
          code: "MEDIA_REVIEW_CORE_PUBLISH_CRASH",
          task_id: input.taskId,
          err: err instanceof Error ? err : new Error(String(err)),
        });
      });
    });
  }

  return { ok: true, status: newStatus };
}
