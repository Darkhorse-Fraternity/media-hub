import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";

import { eq } from "@acme/db";
import { mediaGenerationJob, mediaPlatformAccount } from "@acme/db/schema";
import { log } from "@acme/logger";
import {
  optimizeMediaImagePromptSchema,
  optimizeMediaPlatformDescriptionSchema,
  optimizeMediaPromptSchema,
} from "@acme/validators";

import { protectedProcedure } from "../../trpc";
import {
  buildImagePromptOptimizationPrompt,
  buildPlatformDescriptionPrompt,
  buildVideoPromptOptimizationPrompt,
  queryMediaHubCodex,
} from "./codex-copy";
import { canManageMediaGenerationJob } from "./generation-access";
import { canManageMediaPlatformAccount } from "./platform-account-access";

function codexError(error: unknown, operation: string): TRPCError {
  const normalized = error instanceof Error ? error : new Error(String(error));
  log.error(`Media Hub Codex ${operation} failed`, {
    code: "MEDIA_HUB_CODEX_FAILED",
    operation,
    err: normalized,
  });
  return new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: `AI ${operation}失败：${normalized.message}`,
  });
}

export const mediaAiRouter = {
  optimizePrompt: protectedProcedure
    .input(optimizeMediaPromptSchema)
    .mutation(async ({ input }) => {
      try {
        const prompt = buildVideoPromptOptimizationPrompt(input);
        const text = await queryMediaHubCodex(prompt, 16000);
        return { text };
      } catch (error) {
        throw codexError(error, "优化提示词");
      }
    }),

  optimizeImagePrompt: protectedProcedure
    .input(optimizeMediaImagePromptSchema)
    .mutation(async ({ input }) => {
      try {
        return {
          text: await queryMediaHubCodex(
            buildImagePromptOptimizationPrompt(input),
            5000,
          ),
        };
      } catch (error) {
        throw codexError(error, "优化图片提示词");
      }
    }),

  optimizePlatformDescription: protectedProcedure
    .input(optimizeMediaPlatformDescriptionSchema)
    .mutation(async ({ ctx, input }) => {
      const job = await ctx.db.query.mediaGenerationJob.findFirst({
        where: eq(mediaGenerationJob.id, input.jobId),
      });
      if (!job) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "指定的视频任务不存在",
        });
      }
      const actorRole = (
        ctx.session.user as typeof ctx.session.user & { role?: string }
      ).role;
      if (
        !canManageMediaGenerationJob({
          actorUserId: ctx.session.user.id,
          actorRole,
          ownerUserId: job.createdBy,
        })
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "只能为自己的视频生成发布文案",
        });
      }
      if (job.status !== "succeeded" || !job.outputStorageKey) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "指定的视频尚未生成完成",
        });
      }

      const account = await ctx.db.query.mediaPlatformAccount.findFirst({
        where: eq(mediaPlatformAccount.id, input.accountId),
      });
      if (!account) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "指定的平台账号不存在",
        });
      }
      if (
        !canManageMediaPlatformAccount({
          actorUserId: ctx.session.user.id,
          actorRole,
          ownerUserId: account.createdBy,
        })
      ) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "只能使用自己的平台账号",
        });
      }
      if (account.platform !== "youtube" && account.platform !== "instagram") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `暂不支持为 ${account.platform} 生成发布文案`,
        });
      }

      try {
        const prompt = buildPlatformDescriptionPrompt({
          videoJobId: job.id,
          prompt: job.prompt,
          title: job.title ?? undefined,
          durationSeconds: job.durationSeconds,
          language: job.language === "en" ? "en" : "zh",
          platform: account.platform,
          accountLabel: account.accountLabel,
          currentDescription: input.currentDescription,
        });
        const maxLength = account.platform === "instagram" ? 2200 : 5000;
        return { text: await queryMediaHubCodex(prompt, maxLength) };
      } catch (error) {
        throw codexError(error, "生成平台文案");
      }
    }),
} satisfies TRPCRouterRecord;
