import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";

import { and, count, desc, eq } from "@acme/db";
import { mediaPublishTarget, mediaReviewLog, mediaTask } from "@acme/db/schema";
import { log } from "@acme/logger";
import {
  createMediaTaskSchema,
  mediaTaskListQuerySchema,
  retryMediaPublishSchema,
  reviewMediaTaskSchema,
  submitMediaTaskSchema,
  updateMediaTaskSchema,
} from "@acme/validators";

import { adminProcedure } from "../../trpc";
import { reviewMediaTaskCore } from "./review-core";
import { runPublishForTargets, runPublishForTask } from "./runner";

/**
 * fire-and-forget 跑 worker，不阻塞 tRPC 响应。
 * worker 内部已经 try/catch 把错误写进 db，这里只做兜底日志。
 */
function fireAndForgetPublish(taskId: string) {
  setImmediate(() => {
    runPublishForTask(taskId).catch((err: unknown) => {
      log.error("runPublishForTask top-level threw", {
        code: "MEDIA_PUBLISH_RUNNER_CRASH",
        task_id: taskId,
        err: err instanceof Error ? err : new Error(String(err)),
      });
    });
  });
}

function fireAndForgetRetry(targetIds: string[]) {
  setImmediate(() => {
    runPublishForTargets(targetIds).catch((err: unknown) => {
      log.error("runPublishForTargets top-level threw", {
        code: "MEDIA_RETRY_RUNNER_CRASH",
        target_ids: targetIds.join(","),
        err: err instanceof Error ? err : new Error(String(err)),
      });
    });
  });
}

/**
 * 草稿状态白名单：只有这些状态允许编辑
 */
const EDITABLE_STATUSES = ["draft", "rejected"] as const;

export const mediaTaskRouter = {
  /** 创建草稿任务 + 一组发布目标 */
  create: adminProcedure
    .input(createMediaTaskSchema)
    .mutation(async ({ ctx, input }) => {
      // 校验所有 accountId 真实存在且 platform 匹配
      const accountIds = input.targets.map((t) => t.accountId);
      const accounts = await ctx.db.query.mediaPlatformAccount.findMany({
        where: (acc, { inArray }) => inArray(acc.id, accountIds),
      });
      if (accounts.length !== accountIds.length) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "存在无效的 accountId",
        });
      }
      for (const target of input.targets) {
        const acc = accounts.find((a) => a.id === target.accountId);
        if (acc?.platform !== target.platform) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `account ${target.accountId} 与 platform ${target.platform} 不匹配`,
          });
        }
      }

      const taskId = crypto.randomUUID();
      const now = new Date();

      await ctx.db.transaction(async (tx) => {
        await tx.insert(mediaTask).values({
          id: taskId,
          title: input.title,
          description: input.description,
          hashtags: input.hashtags,
          language: input.language,
          videoStorageKey: input.videoStorageKey,
          coverStorageKey: input.coverStorageKey,
          aiPrompts: input.aiPrompts,
          status: "draft",
          createdBy: ctx.session.user.id,
          createdAt: now,
          updatedAt: now,
        });

        await tx.insert(mediaPublishTarget).values(
          input.targets.map((t) => ({
            id: crypto.randomUUID(),
            taskId,
            platform: t.platform,
            accountId: t.accountId,
            description: t.description,
            status: "pending" as const,
            retryCount: 0,
            createdAt: now,
            updatedAt: now,
          })),
        );
      });

      return { id: taskId };
    }),

  /** 更新草稿（仅 draft / rejected 状态） */
  update: adminProcedure
    .input(updateMediaTaskSchema)
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.mediaTask.findFirst({
        where: eq(mediaTask.id, input.id),
      });
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "任务不存在" });
      }
      if (
        !EDITABLE_STATUSES.includes(
          existing.status as (typeof EDITABLE_STATUSES)[number],
        )
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `当前状态 ${existing.status} 不可编辑`,
        });
      }

      const { id, ...patch } = input;
      await ctx.db
        .update(mediaTask)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(mediaTask.id, id));

      return { ok: true };
    }),

  /** 提交审核（draft → pending_review） */
  submitForReview: adminProcedure
    .input(submitMediaTaskSchema)
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.mediaTask.findFirst({
        where: eq(mediaTask.id, input.id),
      });
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "任务不存在" });
      }
      if (existing.status !== "draft" && existing.status !== "rejected") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `当前状态 ${existing.status} 不可提交审核`,
        });
      }

      const now = new Date();
      await ctx.db.transaction(async (tx) => {
        await tx
          .update(mediaTask)
          .set({ status: "pending_review", updatedAt: now })
          .where(eq(mediaTask.id, input.id));

        await tx.insert(mediaReviewLog).values({
          id: crypto.randomUUID(),
          taskId: input.id,
          reviewer: ctx.session.user.id,
          action: "submit",
          createdAt: now,
        });
      });

      return { ok: true };
    }),

  /** 审核（approve / reject） */
  review: adminProcedure
    .input(reviewMediaTaskSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await reviewMediaTaskCore({
        taskId: input.id,
        action: input.action,
        comment: input.comment,
        reviewerId: ctx.session.user.id,
      });
      if (!result.ok) {
        if (result.error === "task_not_found") {
          throw new TRPCError({ code: "NOT_FOUND", message: "任务不存在" });
        }
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: result.error ?? "review failed",
        });
      }
      return { ok: true };
    }),

  /** 手动重跑发布（task 已 approved 但所有/部分 target 还未跑） */
  runPublish: adminProcedure
    .input(submitMediaTaskSchema) // {id}
    .mutation(({ input }) => {
      fireAndForgetPublish(input.id);
      return { ok: true };
    }),

  /** 重试单个失败的 target */
  retryTarget: adminProcedure
    .input(retryMediaPublishSchema)
    .mutation(async ({ ctx, input }) => {
      const target = await ctx.db.query.mediaPublishTarget.findFirst({
        where: eq(mediaPublishTarget.id, input.targetId),
      });
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "target 不存在" });
      }
      if (target.status === "published") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "已发布成功，不需重试",
        });
      }
      if (target.status === "publishing") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "正在发布中",
        });
      }
      fireAndForgetRetry([input.targetId]);
      return { ok: true };
    }),

  /** 列表分页 */
  list: adminProcedure
    .input(mediaTaskListQuerySchema)
    .query(async ({ ctx, input }) => {
      const where = and(
        input.status ? eq(mediaTask.status, input.status) : undefined,
        input.createdBy ? eq(mediaTask.createdBy, input.createdBy) : undefined,
      );

      const [{ total } = { total: 0 }] = await ctx.db
        .select({ total: count() })
        .from(mediaTask)
        .where(where);

      const offset = (input.page - 1) * input.pageSize;
      const rows = await ctx.db.query.mediaTask.findMany({
        where,
        orderBy: desc(mediaTask.createdAt),
        limit: input.pageSize,
        offset,
      });

      return {
        rows,
        total,
        page: input.page,
        pageSize: input.pageSize,
      };
    }),

  /** 任务详情 + targets + 审核日志 */
  getById: adminProcedure
    .input(submitMediaTaskSchema) // {id}
    .query(async ({ ctx, input }) => {
      const task = await ctx.db.query.mediaTask.findFirst({
        where: eq(mediaTask.id, input.id),
      });
      if (!task) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const targets = await ctx.db.query.mediaPublishTarget.findMany({
        where: eq(mediaPublishTarget.taskId, input.id),
      });

      const accountIds = [...new Set(targets.map((t) => t.accountId))];
      const accounts = accountIds.length
        ? await ctx.db.query.mediaPlatformAccount.findMany({
            where: (acc, { inArray }) => inArray(acc.id, accountIds),
            columns: {
              id: true,
              platform: true,
              accountLabel: true,
              externalAccountId: true,
            },
          })
        : [];

      const reviewLogs = await ctx.db.query.mediaReviewLog.findMany({
        where: eq(mediaReviewLog.taskId, input.id),
        orderBy: desc(mediaReviewLog.createdAt),
      });

      const reviewerIds = [
        ...new Set(reviewLogs.map((r) => r.reviewer).filter(Boolean)),
      ];
      const creatorAndReviewers = [
        ...new Set([task.createdBy, ...reviewerIds]),
      ];
      const users = creatorAndReviewers.length
        ? await ctx.db.query.user.findMany({
            where: (u, { inArray }) => inArray(u.id, creatorAndReviewers),
            columns: { id: true, name: true, email: true },
          })
        : [];

      return {
        task,
        targets,
        accounts,
        reviewLogs,
        users,
      };
    }),
} satisfies TRPCRouterRecord;
