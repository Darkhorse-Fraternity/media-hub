import { randomInt } from "node:crypto";
import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";

import { and, count, desc, eq, inArray, isNull, or } from "@acme/db";
import {
  mediaGenerationJob,
  mediaImageAsset,
  mediaPlatformAccount,
  mediaPublishTarget,
  mediaReviewLog,
  mediaTask,
  mediaUserPreference,
  user as User,
} from "@acme/db/schema";
import { log } from "@acme/logger";
import {
  deleteMediaHubObject,
  getMediaHubPresignedDownloadUrl,
} from "@acme/storage";
import {
  createMediaGenerationSchema,
  createMediaVideoEditSchema,
  mediaGenerationIdSchema,
  mediaGenerationListSchema,
  publishMediaGenerationSchema,
  updateMediaGenerationSchema,
} from "@acme/validators";

import { protectedProcedure } from "../../trpc";
import {
  sendGenerationCancellationAlert,
  sendGenerationResultCard,
} from "./feishu-notify";
import {
  cancelMediaGenerationJob,
  getMediaGenerationProviderHealth,
  rescheduleMediaGenerationJob,
  scheduleMediaGenerationJob,
  startMediaGenerationScheduler,
} from "./generation";
import {
  activeMediaGenerationStatuses,
  canManageMediaGenerationJob,
  isCancelableMediaGenerationStatus,
  isDeletableMediaGenerationStatus,
  isEditableMediaGenerationStatus,
  isProtectedMediaPublishStatus,
  isProtectedMediaTaskStatus,
  isRetryableMediaGenerationStatus,
} from "./generation-access";
import {
  h3StepsForPreset,
  validateH3GenerationPrompt,
} from "./h3-generation-config";
import { requireH3Profile } from "./h3-profile";
import { canManageMediaPlatformAccount } from "./platform-account-access";
import {
  normalizeMediaPublishPlan,
  readMediaPublishPlans,
  writeMediaPublishPlans,
} from "./publish-settings";
import { runPublishForTask, startMediaPublishScheduler } from "./runner";
import { resolveMediaSystemSetting } from "./system-settings";

startMediaGenerationScheduler();
startMediaPublishScheduler();

function fireAndForgetGenerationPublish(taskId: string): void {
  setImmediate(() => {
    runPublishForTask(taskId).catch((error: unknown) => {
      log.error("Generated video publish failed", {
        code: "MEDIA_GENERATION_PUBLISH_CRASH",
        task_id: taskId,
        err: error instanceof Error ? error : new Error(String(error)),
      });
    });
  });
}

export const mediaGenerationRouter = {
  providerHealth: protectedProcedure.query(async () => {
    const [health, systemSettings] = await Promise.all([
      getMediaGenerationProviderHealth(true),
      resolveMediaSystemSetting(),
    ]);
    return {
      ...health,
      defaultGenerationProfile: systemSettings.h3GenerationProfile,
    };
  }),

  create: protectedProcedure
    .input(createMediaGenerationSchema)
    .mutation(async ({ ctx, input }) => {
      startMediaGenerationScheduler();
      const systemSettings = await resolveMediaSystemSetting();
      const scheduledAt = input.scheduledAt ?? null;
      if (scheduledAt && scheduledAt.getTime() <= Date.now()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "定点执行时间必须晚于当前时间",
        });
      }
      if (input.sourceImageStorageKey && !input.sourceImageContentType) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "上传图片后缺少图片类型",
        });
      }
      const promptIssues = validateH3GenerationPrompt(
        input.prompt,
        input.durationSeconds,
      );
      if (promptIssues.length) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `H3 提示词预检失败：${promptIssues.join("；")}`,
        });
      }

      const requestedAssetIds = [
        ...(input.sourceImageAssetId ? [input.sourceImageAssetId] : []),
        ...input.referenceImageAssets.map((reference) => reference.assetId),
      ];
      if (new Set(requestedAssetIds).size !== requestedAssetIds.length) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "不能重复选择同一张素材库图片",
        });
      }
      const selectedAssets = requestedAssetIds.length
        ? await ctx.db.query.mediaImageAsset.findMany({
            where: and(
              inArray(mediaImageAsset.id, requestedAssetIds),
              eq(mediaImageAsset.ownerUserId, ctx.session.user.id),
              isNull(mediaImageAsset.deletedAt),
            ),
          })
        : [];
      if (selectedAssets.length !== requestedAssetIds.length) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "选择的图片素材不存在",
        });
      }
      const selectedAssetById = new Map(
        selectedAssets.map((asset) => [asset.id, asset]),
      );
      const sourceAsset = input.sourceImageAssetId
        ? selectedAssetById.get(input.sourceImageAssetId)
        : undefined;
      const assetReferences = input.referenceImageAssets.map((reference) => {
        const asset = selectedAssetById.get(reference.assetId);
        if (!asset) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "选择的图片素材不存在",
          });
        }
        return {
          storageKey: asset.storageKey,
          name: asset.filename,
          contentType: asset.contentType as
            | "image/jpeg"
            | "image/png"
            | "image/webp",
          role: reference.role,
        };
      });
      const referenceImages = [...input.referenceImages, ...assetReferences];
      if (referenceImages.length > 4) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "最多选择 4 张风格或主体参考图",
        });
      }
      const selectedProfileId =
        input.h3Profile ?? systemSettings.h3GenerationProfile;
      const selectedProfile = await requireH3Profile(
        selectedProfileId,
        "generate",
      );
      if (
        selectedProfile.maxReferenceImages !== null &&
        referenceImages.length > selectedProfile.maxReferenceImages
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `当前 H3 工作流最多支持 ${selectedProfile.maxReferenceImages} 张额外参考图`,
        });
      }

      const id = crypto.randomUUID();
      const now = new Date();
      await ctx.db.insert(mediaGenerationJob).values({
        id,
        prompt: input.prompt,
        title: input.title,
        language: input.language,
        sourceImageStorageKey:
          sourceAsset?.storageKey ?? input.sourceImageStorageKey,
        sourceImageName: sourceAsset?.filename ?? input.sourceImageName,
        sourceImageContentType:
          sourceAsset?.contentType ?? input.sourceImageContentType,
        referenceImages,
        inputImageAssetIds: requestedAssetIds,
        durationSeconds: input.durationSeconds,
        fps: 24,
        width: input.width,
        height: input.height,
        qualityPreset: input.qualityPreset,
        steps: Math.max(
          h3StepsForPreset(input.qualityPreset),
          selectedProfile.minimumSteps ?? 1,
        ),
        seed: input.seed ?? randomInt(0, 2_147_483_643),
        profile: selectedProfileId,
        status: scheduledAt ? "scheduled" : "queued",
        scheduledAt,
        createdBy: ctx.session.user.id,
        createdAt: now,
        updatedAt: now,
      });

      scheduleMediaGenerationJob(id, scheduledAt);
      return { id, status: scheduledAt ? "scheduled" : "queued" };
    }),

  createEdit: protectedProcedure
    .input(createMediaVideoEditSchema)
    .mutation(async ({ ctx, input }) => {
      startMediaGenerationScheduler();
      const systemSettings = await resolveMediaSystemSetting();
      const selectedProfile = await requireH3Profile(
        systemSettings.h3EditProfile,
        "edit",
      );
      const sourceJob = await ctx.db.query.mediaGenerationJob.findFirst({
        where: eq(mediaGenerationJob.id, input.sourceGenerationJobId),
      });
      if (sourceJob?.status !== "succeeded" || !sourceJob.outputStorageKey) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "只能修改已经生成完成且文件仍存在的视频",
        });
      }
      const actorRole = (
        ctx.session.user as typeof ctx.session.user & { role?: string }
      ).role;
      if (
        !canManageMediaGenerationJob({
          actorUserId: ctx.session.user.id,
          actorRole,
          ownerUserId: sourceJob.createdBy,
        })
      ) {
        throw new TRPCError({ code: "FORBIDDEN", message: "无权修改该视频" });
      }
      const scheduledAt = input.scheduledAt ?? null;
      if (scheduledAt && scheduledAt.getTime() <= Date.now()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "定点执行时间必须晚于当前时间",
        });
      }
      const orderedSegments = [...input.segments].sort(
        (left, right) => left.startSeconds - right.startSeconds,
      );
      if (
        orderedSegments.some(
          (segment) => segment.endSeconds > sourceJob.durationSeconds,
        )
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "修改片段不能超出源视频时长",
        });
      }

      const id = crypto.randomUUID();
      const now = new Date();
      const prompt = orderedSegments
        .map(
          (segment) =>
            `${segment.startSeconds.toFixed(1)}–${segment.endSeconds.toFixed(1)}s: ${segment.prompt}`,
        )
        .join("\n");
      await ctx.db.insert(mediaGenerationJob).values({
        id,
        scriptId: sourceJob.scriptId,
        scriptShotId: sourceJob.scriptShotId,
        kind: "edit",
        sourceGenerationJobId: sourceJob.id,
        editSegments: orderedSegments,
        providerJobIds: [],
        preserveSourceAudio: true,
        prompt,
        title: input.title?.trim() ?? `修改：${sourceJob.title ?? "AI 视频"}`,
        language: input.language,
        referenceImages: [],
        durationSeconds: sourceJob.durationSeconds,
        fps: sourceJob.fps,
        width: sourceJob.width,
        height: sourceJob.height,
        qualityPreset: "quality",
        steps: Math.max(20, selectedProfile.minimumSteps ?? 1),
        seed: randomInt(0, 2_147_483_643),
        profile: systemSettings.h3EditProfile,
        status: scheduledAt ? "scheduled" : "queued",
        scheduledAt,
        createdBy: ctx.session.user.id,
        createdAt: now,
        updatedAt: now,
      });

      scheduleMediaGenerationJob(id, scheduledAt);
      return {
        id,
        status: scheduledAt ? "scheduled" : "queued",
        sourceGenerationJobId: sourceJob.id,
        scriptId: sourceJob.scriptId,
        scriptShotId: sourceJob.scriptShotId,
      };
    }),

  list: protectedProcedure
    .input(mediaGenerationListSchema)
    .query(async ({ ctx, input }) => {
      startMediaGenerationScheduler();
      const actorRole = (
        ctx.session.user as typeof ctx.session.user & { role?: string }
      ).role;
      const requestedStatuses = input.status ? [input.status] : input.statuses;
      const statusWhere = requestedStatuses?.length
        ? inArray(mediaGenerationJob.status, requestedStatuses)
        : undefined;
      const where =
        actorRole === "admin"
          ? statusWhere
          : and(
              statusWhere,
              or(
                eq(mediaGenerationJob.createdBy, ctx.session.user.id),
                inArray(mediaGenerationJob.status, [
                  ...activeMediaGenerationStatuses,
                ]),
              ),
            );
      const [{ total } = { total: 0 }] = await ctx.db
        .select({ total: count() })
        .from(mediaGenerationJob)
        .where(where);
      const rows = await ctx.db.query.mediaGenerationJob.findMany({
        where,
        orderBy: desc(mediaGenerationJob.createdAt),
        limit: input.pageSize,
        offset: (input.page - 1) * input.pageSize,
      });
      const detailedRows = rows.filter((row) =>
        canManageMediaGenerationJob({
          actorUserId: ctx.session.user.id,
          actorRole,
          ownerUserId: row.createdBy,
        }),
      );
      const creatorIds = [...new Set(detailedRows.map((row) => row.createdBy))];
      const creators = creatorIds.length
        ? await ctx.db.query.user.findMany({
            where: inArray(User.id, creatorIds),
            columns: { id: true, name: true, email: true },
          })
        : [];
      const creatorById = new Map(
        creators.map((creator) => [creator.id, creator]),
      );
      const taskIds = detailedRows
        .map((row) => row.mediaTaskId)
        .filter((id): id is string => Boolean(id));
      const tasks = taskIds.length
        ? await ctx.db.query.mediaTask.findMany({
            where: inArray(mediaTask.id, taskIds),
            columns: { id: true, status: true, aiPrompts: true },
          })
        : [];
      const taskById = new Map(tasks.map((task) => [task.id, task]));
      const targets = taskIds.length
        ? await ctx.db.query.mediaPublishTarget.findMany({
            where: inArray(mediaPublishTarget.taskId, taskIds),
          })
        : [];
      const accountIds = [
        ...new Set(targets.map((target) => target.accountId)),
      ];
      const accounts = accountIds.length
        ? await ctx.db.query.mediaPlatformAccount.findMany({
            where: inArray(mediaPlatformAccount.id, accountIds),
            columns: {
              id: true,
              platform: true,
              accountLabel: true,
              externalAccountId: true,
            },
          })
        : [];
      const accountById = new Map(
        accounts.map((account) => [account.id, account]),
      );
      const targetsByTaskId = new Map<string, (typeof targets)[number][]>();
      for (const target of targets) {
        const list = targetsByTaskId.get(target.taskId) ?? [];
        list.push(target);
        targetsByTaskId.set(target.taskId, list);
      }
      return {
        rows: rows.map((row, index) => {
          const canManage = canManageMediaGenerationJob({
            actorUserId: ctx.session.user.id,
            actorRole,
            ownerUserId: row.createdBy,
          });
          if (!canManage) {
            return {
              id: `private-${(input.page - 1) * input.pageSize + index}`,
              isPrivate: true as const,
            };
          }
          const publishTargets = row.mediaTaskId
            ? (targetsByTaskId.get(row.mediaTaskId) ?? []).map((target) => {
                const account = accountById.get(target.accountId);
                const publishPlan = readMediaPublishPlans(
                  taskById.get(row.mediaTaskId ?? "")?.aiPrompts,
                )[target.accountId];
                return {
                  ...target,
                  accountLabel: account?.accountLabel ?? "未知账户",
                  externalAccountId: account?.externalAccountId ?? null,
                  publishPlan: publishPlan ?? null,
                };
              })
            : [];
          const taskStatus = row.mediaTaskId
            ? taskById.get(row.mediaTaskId)?.status
            : undefined;
          const canRemove =
            isDeletableMediaGenerationStatus(row.status) &&
            !publishTargets.some((target) =>
              isProtectedMediaPublishStatus(target.status),
            ) &&
            !(taskStatus && isProtectedMediaTaskStatus(taskStatus));

          return {
            ...row,
            isPrivate: false as const,
            creator: creatorById.get(row.createdBy) ?? null,
            canManage,
            canRemove,
            canRetry: isRetryableMediaGenerationStatus(row.status),
            publishTargets,
          };
        }),
        total,
        page: input.page,
        pageSize: input.pageSize,
      };
    }),

  getById: protectedProcedure
    .input(mediaGenerationIdSchema)
    .query(async ({ ctx, input }) => {
      const job = await ctx.db.query.mediaGenerationJob.findFirst({
        where: eq(mediaGenerationJob.id, input.id),
      });
      if (!job)
        throw new TRPCError({ code: "NOT_FOUND", message: "生成任务不存在" });
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
        throw new TRPCError({ code: "NOT_FOUND", message: "生成任务不存在" });
      }
      return job;
    }),

  update: protectedProcedure
    .input(updateMediaGenerationSchema)
    .mutation(async ({ ctx, input }) => {
      const job = await ctx.db.query.mediaGenerationJob.findFirst({
        where: eq(mediaGenerationJob.id, input.id),
      });
      if (!job) {
        throw new TRPCError({ code: "NOT_FOUND", message: "生成任务不存在" });
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
          message: "只能修改自己的生成任务",
        });
      }
      if (!isEditableMediaGenerationStatus(job.status)) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "只有排队中或定时中的任务可以修改",
        });
      }
      if (input.scheduledAt && input.scheduledAt.getTime() <= Date.now()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "定点执行时间必须晚于当前时间",
        });
      }
      if (job.kind === "generate") {
        const promptIssues = validateH3GenerationPrompt(
          input.prompt,
          input.durationSeconds,
        );
        if (promptIssues.length) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `H3 提示词预检失败：${promptIssues.join("；")}`,
          });
        }
      }

      const nextStatus = input.scheduledAt ? "scheduled" : "queued";
      const trimmedTitle = input.title?.trim();
      const [updated] = await ctx.db
        .update(mediaGenerationJob)
        .set({
          prompt: input.prompt,
          title: trimmedTitle ?? null,
          language: input.language,
          durationSeconds: input.durationSeconds,
          ...(job.kind === "generate"
            ? {
                qualityPreset: input.qualityPreset,
                steps: h3StepsForPreset(input.qualityPreset),
              }
            : {}),
          scheduledAt: input.scheduledAt,
          status: nextStatus,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(mediaGenerationJob.id, job.id),
            eq(mediaGenerationJob.status, job.status),
          ),
        )
        .returning({ id: mediaGenerationJob.id });
      if (!updated) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "任务状态已变化，请刷新后重试",
        });
      }

      rescheduleMediaGenerationJob(job.id, input.scheduledAt);
      log.info("Media generation job updated", {
        code: "MEDIA_GENERATION_UPDATED",
        job_id: job.id,
        actor_user_id: ctx.session.user.id,
        owner_user_id: job.createdBy,
        status: nextStatus,
      });
      return { ok: true, status: nextStatus };
    }),

  getDownloadUrl: protectedProcedure
    .input(mediaGenerationIdSchema)
    .mutation(async ({ ctx, input }) => {
      const job = await ctx.db.query.mediaGenerationJob.findFirst({
        where: eq(mediaGenerationJob.id, input.id),
      });
      if (!job)
        throw new TRPCError({ code: "NOT_FOUND", message: "生成任务不存在" });
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
        throw new TRPCError({ code: "NOT_FOUND", message: "生成任务不存在" });
      }
      if (!job.outputStorageKey) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "视频尚未生成完成",
        });
      }
      return {
        url: await getMediaHubPresignedDownloadUrl(job.outputStorageKey, 3600),
      };
    }),

  /** 管理员或任务所有者向任务创建人配置的 Webhook 重发生成结果。 */
  resendNotification: protectedProcedure
    .input(mediaGenerationIdSchema)
    .mutation(async ({ ctx, input }) => {
      const job = await ctx.db.query.mediaGenerationJob.findFirst({
        where: eq(mediaGenerationJob.id, input.id),
      });
      if (!job) {
        throw new TRPCError({ code: "NOT_FOUND", message: "生成任务不存在" });
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
          message: "无权发送该任务通知",
        });
      }
      if (job.status !== "succeeded" || !job.outputStorageKey) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "只有已完成的视频可以重发通知",
        });
      }

      const [creator, recipientPreference] = await Promise.all([
        ctx.db.query.user.findFirst({
          where: eq(User.id, job.createdBy),
          columns: { name: true, email: true },
        }),
        ctx.db.query.mediaUserPreference.findFirst({
          where: eq(mediaUserPreference.userId, job.createdBy),
          columns: { feishuWebhookUrl: true },
        }),
      ]);
      const appUrl = process.env.APP_URL?.replace(/\/$/, "");
      await sendGenerationResultCard({
        jobId: job.id,
        title: job.title,
        prompt: job.prompt,
        status: "succeeded",
        operation: job.kind === "edit" ? "edit" : "generate",
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
        providerJobId: job.providerJobId,
        createdByLabel: creator
          ? `${creator.name} (${creator.email})`
          : job.createdBy,
        videoUrl: appUrl ? `${appUrl}/#generation-job-${job.id}` : undefined,
        recipientWebhookUrl: recipientPreference?.feishuWebhookUrl,
      });
      log.info("Media generation result notification resent", {
        code: "MEDIA_GENERATION_RESULT_CARD_RESENT",
        job_id: job.id,
        actor_user_id: ctx.session.user.id,
      });
      return { ok: true };
    }),

  /** 登录成员明确选择账户后，将生成成品直接上传到对应平台。 */
  publish: protectedProcedure
    .input(publishMediaGenerationSchema)
    .mutation(async ({ ctx, input }) => {
      const job = await ctx.db.query.mediaGenerationJob.findFirst({
        where: eq(mediaGenerationJob.id, input.id),
      });
      if (!job) {
        throw new TRPCError({ code: "NOT_FOUND", message: "生成任务不存在" });
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
          message: "只能发布自己的生成任务",
        });
      }
      if (job.status !== "succeeded" || !job.mediaTaskId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "视频尚未生成完成",
        });
      }

      const task = await ctx.db.query.mediaTask.findFirst({
        where: eq(mediaTask.id, job.mediaTaskId),
      });
      if (!task) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "视频对应的媒体任务不存在",
        });
      }

      const accountIds = input.targets.map((target) => target.accountId);
      const inputByAccountId = new Map(
        input.targets.map((target) => [target.accountId, target]),
      );
      const descriptionByAccountId = new Map(
        input.targets.map((target) => [
          target.accountId,
          target.description?.trim() ? target.description.trim() : null,
        ]),
      );
      const accounts = await ctx.db.query.mediaPlatformAccount.findMany({
        where: inArray(mediaPlatformAccount.id, accountIds),
      });
      if (accounts.length !== accountIds.length) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "存在无效或已解绑的上传账户",
        });
      }
      const unauthorizedAccount = accounts.find(
        (account) =>
          !canManageMediaPlatformAccount({
            actorUserId: ctx.session.user.id,
            actorRole,
            ownerUserId: account.createdBy,
          }),
      );
      if (unauthorizedAccount) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "只能发布到自己的平台账号",
        });
      }
      const unsupported = accounts.find(
        (account) => !["youtube", "instagram"].includes(account.platform),
      );
      if (unsupported) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `暂不支持上传到 ${unsupported.platform}`,
        });
      }
      const scheduledInPast = input.targets.find(
        (target) =>
          target.scheduledAt && target.scheduledAt.getTime() <= Date.now(),
      );
      if (scheduledInPast) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "定时发布时间必须晚于当前时间",
        });
      }
      const overlongYouTubeTitle = accounts.find((account) => {
        const targetInput = inputByAccountId.get(account.id);
        const requestedTitle = targetInput?.title?.trim();
        const publishTitle = requestedTitle?.length
          ? requestedTitle
          : task.title;
        return account.platform === "youtube" && publishTitle.length > 100;
      });
      if (overlongYouTubeTitle) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "YouTube 标题不能超过 100 个字符",
        });
      }
      const overlongInstagramDescription = accounts.find((account) => {
        if (account.platform !== "instagram") return false;
        const targetInput = inputByAccountId.get(account.id);
        const requestedTitle = targetInput?.title?.trim();
        const publishTitle = requestedTitle?.length
          ? requestedTitle
          : task.title;
        return (
          [
            publishTitle,
            descriptionByAccountId.get(account.id),
            targetInput?.hashtags?.trim(),
          ]
            .filter(Boolean)
            .join("\n\n").length > 2200
        );
      });
      if (overlongInstagramDescription) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Instagram 发布文案不能超过 2200 个字符",
        });
      }
      const invalidInstagramCoverTime = accounts.find((account) => {
        const thumbOffsetMs = inputByAccountId.get(account.id)?.instagram
          ?.thumbOffsetMs;
        return (
          account.platform === "instagram" &&
          thumbOffsetMs !== null &&
          thumbOffsetMs !== undefined &&
          thumbOffsetMs > job.durationSeconds * 1000
        );
      });
      if (invalidInstagramCoverTime) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Instagram 封面时间不能超过视频时长",
        });
      }

      const existingTargets = await ctx.db.query.mediaPublishTarget.findMany({
        where: eq(mediaPublishTarget.taskId, task.id),
      });
      if (existingTargets.some((target) => target.status === "publishing")) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "已有平台正在上传，请等待完成后再操作",
        });
      }

      const selectedAccountIds = new Set(accountIds);
      const existingByAccountId = new Map(
        existingTargets.map((target) => [target.accountId, target]),
      );
      const removableTargetIds = existingTargets
        .filter(
          (target) =>
            ["pending", "failed"].includes(target.status) &&
            !selectedAccountIds.has(target.accountId),
        )
        .map((target) => target.id);
      const selectedEditableTargets = existingTargets.filter(
        (target) =>
          ["pending", "failed"].includes(target.status) &&
          selectedAccountIds.has(target.accountId),
      );
      const missingAccounts = accounts.filter(
        (account) => !existingByAccountId.has(account.id),
      );
      const queuedCount =
        selectedEditableTargets.length + missingAccounts.length;
      const alreadyPublishedCount = existingTargets.filter(
        (target) =>
          target.status === "published" &&
          selectedAccountIds.has(target.accountId),
      ).length;
      const editableAccountIds = new Set([
        ...selectedEditableTargets.map((target) => target.accountId),
        ...missingAccounts.map((account) => account.id),
      ]);
      const publishPlans = readMediaPublishPlans(task.aiPrompts);
      for (const targetId of removableTargetIds) {
        const removableTarget = existingTargets.find(
          (target) => target.id === targetId,
        );
        if (removableTarget) delete publishPlans[removableTarget.accountId];
      }
      for (const accountId of editableAccountIds) {
        const targetInput = inputByAccountId.get(accountId);
        if (!targetInput) continue;
        publishPlans[accountId] = normalizeMediaPublishPlan({
          title: targetInput.title,
          hashtags: targetInput.hashtags,
          scheduledAt: targetInput.scheduledAt?.toISOString() ?? null,
          youtube: targetInput.youtube,
          instagram: targetInput.instagram,
        });
      }
      const scheduledCount = [...editableAccountIds].filter(
        (accountId) => publishPlans[accountId]?.scheduledAt,
      ).length;
      const immediateCount = queuedCount - scheduledCount;

      const now = new Date();
      await ctx.db.transaction(async (tx) => {
        if (removableTargetIds.length) {
          await tx
            .delete(mediaPublishTarget)
            .where(inArray(mediaPublishTarget.id, removableTargetIds));
        }
        for (const target of selectedEditableTargets) {
          await tx
            .update(mediaPublishTarget)
            .set({
              description: descriptionByAccountId.get(target.accountId),
              status: "pending",
              errorMessage: null,
              updatedAt: now,
            })
            .where(eq(mediaPublishTarget.id, target.id));
        }
        if (missingAccounts.length) {
          await tx.insert(mediaPublishTarget).values(
            missingAccounts.map((account) => ({
              id: crypto.randomUUID(),
              taskId: task.id,
              platform: account.platform,
              accountId: account.id,
              description: descriptionByAccountId.get(account.id),
              status: "pending" as const,
              retryCount: 0,
              createdAt: now,
              updatedAt: now,
            })),
          );
        }
        if (queuedCount > 0 || removableTargetIds.length > 0) {
          await tx
            .update(mediaTask)
            .set({
              aiPrompts: writeMediaPublishPlans(task.aiPrompts, publishPlans),
              ...(queuedCount > 0
                ? {
                    status: "approved",
                    reviewedBy: ctx.session.user.id,
                    reviewedAt: now,
                  }
                : {}),
              updatedAt: now,
            })
            .where(eq(mediaTask.id, task.id));
        }
        if (queuedCount > 0) {
          await tx.insert(mediaReviewLog).values({
            id: crypto.randomUUID(),
            taskId: task.id,
            reviewer: ctx.session.user.id,
            action: "approve",
            comment: "成员从 H3 生成后台直接上传",
            createdAt: now,
          });
        }
      });

      if (queuedCount > 0) fireAndForgetGenerationPublish(task.id);
      return {
        ok: true,
        queuedCount,
        immediateCount,
        scheduledCount,
        alreadyPublishedCount,
      };
    }),

  /** 失败任务保留原参数并立即重新加入生成队列。 */
  retry: protectedProcedure
    .input(mediaGenerationIdSchema)
    .mutation(async ({ ctx, input }) => {
      const job = await ctx.db.query.mediaGenerationJob.findFirst({
        where: eq(mediaGenerationJob.id, input.id),
      });
      if (!job) {
        throw new TRPCError({ code: "NOT_FOUND", message: "生成任务不存在" });
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
          message: "只能重试自己的生成任务",
        });
      }
      if (!isRetryableMediaGenerationStatus(job.status)) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "只有生成失败的任务可以重试",
        });
      }

      const providerHealth = await getMediaGenerationProviderHealth(true);
      if (providerHealth.status !== "healthy") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `H3 生成链路异常，暂时不能重试：${providerHealth.message}`,
        });
      }
      const now = new Date();
      const [updated] = await ctx.db
        .update(mediaGenerationJob)
        .set({
          status: "queued",
          scheduledAt: null,
          providerJobId: null,
          providerJobIds: [],
          outputStorageKey: null,
          mediaTaskId: null,
          errorMessage: null,
          errorCode: null,
          failureStage: null,
          errorRetryable: null,
          gpuBrokerRequestId: null,
          gpuBrokerLeaseId: null,
          asrTranscript: null,
          asrMatchPercent: null,
          workflowVersion: null,
          modelVersion: null,
          startedAt: null,
          finishedAt: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(mediaGenerationJob.id, job.id),
            eq(mediaGenerationJob.status, "failed"),
          ),
        )
        .returning({ id: mediaGenerationJob.id });
      if (!updated) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "任务状态已变化，请刷新后重试",
        });
      }
      rescheduleMediaGenerationJob(job.id, null);
      log.info("Media generation job retried", {
        code: "MEDIA_GENERATION_RETRIED",
        job_id: job.id,
        job_kind: job.kind,
        actor_user_id: ctx.session.user.id,
        owner_user_id: job.createdBy,
      });
      return { ok: true, status: "queued" as const };
    }),

  cancel: protectedProcedure
    .input(mediaGenerationIdSchema)
    .mutation(async ({ ctx, input }) => {
      const job = await ctx.db.query.mediaGenerationJob.findFirst({
        where: eq(mediaGenerationJob.id, input.id),
      });
      if (!job) {
        throw new TRPCError({ code: "NOT_FOUND", message: "生成任务不存在" });
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
          message: "只能取消自己的生成任务",
        });
      }
      if (!isCancelableMediaGenerationStatus(job.status)) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "该任务当前状态不能取消",
        });
      }

      await cancelMediaGenerationJob(input.id);
      const [creator, recipientPreference] = await Promise.all([
        ctx.db.query.user.findFirst({
          where: eq(User.id, job.createdBy),
          columns: { name: true, email: true },
        }),
        ctx.db.query.mediaUserPreference.findFirst({
          where: eq(mediaUserPreference.userId, job.createdBy),
          columns: { feishuWebhookUrl: true },
        }),
      ]);
      const creatorLabel = creator
        ? `${creator.name} (${creator.email})`
        : job.createdBy;
      const canceledByLabel = `${ctx.session.user.name} (${ctx.session.user.email})`;
      log.warn("Media generation job canceled", {
        code: "MEDIA_GENERATION_CANCELED",
        job_id: job.id,
        actor_user_id: ctx.session.user.id,
        owner_user_id: job.createdBy,
        previous_status: job.status,
      });
      void sendGenerationCancellationAlert({
        jobId: job.id,
        title: job.title,
        prompt: job.prompt,
        previousStatus: job.status,
        createdByLabel: creatorLabel,
        canceledByLabel,
        recipientWebhookUrl: recipientPreference?.feishuWebhookUrl,
      }).catch((error: unknown) => {
        log.error("Media generation cancel alert failed", {
          code: "MEDIA_GENERATION_CANCEL_ALERT_FAILED",
          job_id: job.id,
          err: error instanceof Error ? error : new Error(String(error)),
        });
      });
      return { ok: true };
    }),

  remove: protectedProcedure
    .input(mediaGenerationIdSchema)
    .mutation(async ({ ctx, input }) => {
      const job = await ctx.db.query.mediaGenerationJob.findFirst({
        where: eq(mediaGenerationJob.id, input.id),
      });
      if (!job) {
        throw new TRPCError({ code: "NOT_FOUND", message: "生成任务不存在" });
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
          message: "只能删除自己的生成任务",
        });
      }
      if (!isDeletableMediaGenerationStatus(job.status)) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "只能删除已完成、失败或已取消的任务",
        });
      }

      const task = job.mediaTaskId
        ? await ctx.db.query.mediaTask.findFirst({
            where: eq(mediaTask.id, job.mediaTaskId),
          })
        : null;
      const targets = task
        ? await ctx.db.query.mediaPublishTarget.findMany({
            where: eq(mediaPublishTarget.taskId, task.id),
          })
        : [];
      const hasProtectedPublish = targets.some((target) =>
        isProtectedMediaPublishStatus(target.status),
      );
      const hasProtectedTaskStatus =
        task && isProtectedMediaTaskStatus(task.status);
      if (hasProtectedPublish || hasProtectedTaskStatus) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "视频正在上传，不能删除",
        });
      }
      const activeEdit = await ctx.db.query.mediaGenerationJob.findFirst({
        where: and(
          eq(mediaGenerationJob.sourceGenerationJobId, job.id),
          inArray(mediaGenerationJob.status, [
            "scheduled",
            "queued",
            "waiting_for_gpu",
            "running",
          ]),
        ),
        columns: { id: true },
      });
      if (activeEdit) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "该视频仍有排队或运行中的 Ref2VA 修改任务，暂时不能删除",
        });
      }

      await ctx.db.transaction(async (tx) => {
        const [deleted] = await tx
          .delete(mediaGenerationJob)
          .where(
            and(
              eq(mediaGenerationJob.id, job.id),
              eq(mediaGenerationJob.status, job.status),
            ),
          )
          .returning({ id: mediaGenerationJob.id });
        if (!deleted) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "任务状态已变化，请刷新后重试",
          });
        }
        if (task) {
          await tx.delete(mediaTask).where(eq(mediaTask.id, task.id));
        }
      });

      const storageKeys = [
        job.sourceImageStorageKey,
        ...job.referenceImages.map((image) => image.storageKey),
        ...job.editSegments.flatMap((segment) =>
          segment.referenceImages.map((image) => image.storageKey),
        ),
        job.outputStorageKey,
        task?.videoStorageKey,
        task?.coverStorageKey,
      ].filter((key): key is string => Boolean(key));
      const uniqueStorageKeys = [...new Set(storageKeys)];
      const cleanupResults = await Promise.allSettled(
        uniqueStorageKeys.map((key) => deleteMediaHubObject(key)),
      );
      const failedStorageKeys = uniqueStorageKeys.filter(
        (_, index) => cleanupResults[index]?.status === "rejected",
      );
      if (failedStorageKeys.length > 0) {
        log.error("Deleted media generation job left storage objects", {
          code: "MEDIA_GENERATION_DELETE_STORAGE_FAILED",
          job_id: job.id,
          storage_keys: failedStorageKeys,
        });
      }
      log.warn("Media generation job permanently deleted", {
        code: "MEDIA_GENERATION_DELETED",
        job_id: job.id,
        actor_user_id: ctx.session.user.id,
        owner_user_id: job.createdBy,
        previous_status: job.status,
      });
      return {
        ok: true,
        storageCleanupFailed: failedStorageKeys.length > 0,
      };
    }),
} satisfies TRPCRouterRecord;
