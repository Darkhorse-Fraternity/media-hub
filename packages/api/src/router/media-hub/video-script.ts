import { createHash, randomInt } from "node:crypto";
import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";

import type { db as mediaHubDb } from "@acme/db/client";
import type { MediaVideoScriptShot } from "@acme/validators";
import { and, count, desc, eq, inArray, isNull } from "@acme/db";
import {
  mediaGenerationJob,
  mediaImageAsset,
  mediaVideoScript,
} from "@acme/db/schema";
import {
  deleteMediaHubObject,
  getMediaHubObject,
  putMediaHubObject,
} from "@acme/storage";
import {
  analyzeMediaVideoScriptSchema,
  analyzeMediaVideoScriptShots,
  bridgeMediaVideoScriptFrameSchema,
  createMediaVideoScriptSchema,
  draftMediaVideoScriptSchema,
  generateMediaVideoScriptSchema,
  mediaVideoScriptIdSchema,
  mediaVideoScriptListSchema,
  updateMediaVideoScriptSchema,
} from "@acme/validators";

import { protectedProcedure } from "../../trpc";
import { queryMediaHubCodex } from "./codex-copy";
import {
  scheduleMediaGenerationJob,
  startMediaGenerationScheduler,
} from "./generation";
import {
  h3StepsForPreset,
  validateH3GenerationPrompt,
} from "./h3-generation-config";
import { requireH3Profile } from "./h3-profile";
import { resolveMediaSystemSetting } from "./system-settings";
import { extractMediaGenerationLastFrame } from "./video-frame";
import {
  buildVideoScriptDraftPrompt,
  compileVideoScriptShotPrompt,
  parseVideoScriptDraft,
} from "./video-script-core";

type MediaHubDb = typeof mediaHubDb;

function scriptSummary<T extends { shots: MediaVideoScriptShot[] }>(script: T) {
  return {
    ...script,
    shotCount: script.shots.length,
    totalDurationSeconds: script.shots.reduce(
      (total, shot) => total + shot.durationSeconds,
      0,
    ),
    analysis: analyzeMediaVideoScriptShots(script.shots),
  };
}

async function requireOwnedFirstFrameAssets(
  database: MediaHubDb,
  userId: string,
  shots: MediaVideoScriptShot[],
) {
  const ids = [
    ...new Set(
      shots
        .map((shot) => shot.firstFrameAssetId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  if (ids.length === 0)
    return new Map<string, typeof mediaImageAsset.$inferSelect>();
  const assets = await database.query.mediaImageAsset.findMany({
    where: and(
      inArray(mediaImageAsset.id, ids),
      eq(mediaImageAsset.ownerUserId, userId),
      isNull(mediaImageAsset.deletedAt),
    ),
  });
  if (assets.length !== ids.length) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "脚本引用的首帧素材不存在或不属于当前用户",
    });
  }
  return new Map(assets.map((asset) => [asset.id, asset]));
}

export const mediaVideoScriptRouter = {
  list: protectedProcedure
    .input(mediaVideoScriptListSchema)
    .query(async ({ ctx, input }) => {
      const where = and(
        eq(mediaVideoScript.createdBy, ctx.session.user.id),
        isNull(mediaVideoScript.deletedAt),
      );
      const [rows, totalRows] = await Promise.all([
        ctx.db.query.mediaVideoScript.findMany({
          where,
          orderBy: desc(mediaVideoScript.updatedAt),
          limit: input.pageSize,
          offset: (input.page - 1) * input.pageSize,
        }),
        ctx.db.select({ total: count() }).from(mediaVideoScript).where(where),
      ]);
      return {
        rows: rows.map(scriptSummary),
        total: totalRows[0]?.total ?? 0,
        page: input.page,
        pageSize: input.pageSize,
      };
    }),

  get: protectedProcedure
    .input(mediaVideoScriptIdSchema)
    .query(async ({ ctx, input }) => {
      const script = await ctx.db.query.mediaVideoScript.findFirst({
        where: and(
          eq(mediaVideoScript.id, input.id),
          eq(mediaVideoScript.createdBy, ctx.session.user.id),
          isNull(mediaVideoScript.deletedAt),
        ),
      });
      if (!script) {
        throw new TRPCError({ code: "NOT_FOUND", message: "视频脚本不存在" });
      }
      const jobs = await ctx.db.query.mediaGenerationJob.findMany({
        where: and(
          eq(mediaGenerationJob.scriptId, script.id),
          eq(mediaGenerationJob.createdBy, ctx.session.user.id),
        ),
        orderBy: desc(mediaGenerationJob.createdAt),
      });
      return {
        ...scriptSummary(script),
        shotJobs: jobs.map((job) => ({
          id: job.id,
          scriptShotId: job.scriptShotId,
          kind: job.kind,
          sourceGenerationJobId: job.sourceGenerationJobId,
          title: job.title,
          status: job.status,
          profile: job.profile,
          errorMessage: job.errorMessage,
          outputStorageKey: job.outputStorageKey,
          createdAt: job.createdAt,
          finishedAt: job.finishedAt,
        })),
      };
    }),

  draft: protectedProcedure
    .input(draftMediaVideoScriptSchema)
    .mutation(async ({ input }) => {
      const response = await queryMediaHubCodex(
        buildVideoScriptDraftPrompt(input),
        60_000,
      );
      return parseVideoScriptDraft(response);
    }),

  analyze: protectedProcedure
    .input(analyzeMediaVideoScriptSchema)
    .mutation(({ input }) => ({
      issues: analyzeMediaVideoScriptShots(input.shots),
    })),

  create: protectedProcedure
    .input(createMediaVideoScriptSchema)
    .mutation(async ({ ctx, input }) => {
      if (input.defaultProfile) {
        await requireH3Profile(input.defaultProfile, "generate");
      }
      await requireOwnedFirstFrameAssets(
        ctx.db,
        ctx.session.user.id,
        input.shots,
      );
      const id = crypto.randomUUID();
      const now = new Date();
      const [script] = await ctx.db
        .insert(mediaVideoScript)
        .values({
          id,
          ...input,
          defaultProfile: input.defaultProfile ?? null,
          status: input.shots.length > 0 ? "ready" : "draft",
          version: 1,
          createdBy: ctx.session.user.id,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!script) throw new Error("视频脚本创建失败");
      return scriptSummary(script);
    }),

  update: protectedProcedure
    .input(updateMediaVideoScriptSchema)
    .mutation(async ({ ctx, input }) => {
      if (input.defaultProfile) {
        await requireH3Profile(input.defaultProfile, "generate");
      }
      await requireOwnedFirstFrameAssets(
        ctx.db,
        ctx.session.user.id,
        input.shots,
      );
      const [updated] = await ctx.db
        .update(mediaVideoScript)
        .set({
          title: input.title,
          brief: input.brief,
          language: input.language,
          width: input.width,
          height: input.height,
          defaultProfile: input.defaultProfile ?? null,
          continuityBible: input.continuityBible,
          shots: input.shots,
          status: input.shots.length > 0 ? "ready" : "draft",
          version: input.version + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(mediaVideoScript.id, input.id),
            eq(mediaVideoScript.createdBy, ctx.session.user.id),
            eq(mediaVideoScript.version, input.version),
            isNull(mediaVideoScript.deletedAt),
          ),
        )
        .returning();
      if (!updated) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "脚本已在其他页面更新，请刷新后重试",
        });
      }
      return scriptSummary(updated);
    }),

  delete: protectedProcedure
    .input(mediaVideoScriptIdSchema)
    .mutation(async ({ ctx, input }) => {
      const [deleted] = await ctx.db
        .update(mediaVideoScript)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(mediaVideoScript.id, input.id),
            eq(mediaVideoScript.createdBy, ctx.session.user.id),
            isNull(mediaVideoScript.deletedAt),
          ),
        )
        .returning({ id: mediaVideoScript.id });
      if (!deleted) {
        throw new TRPCError({ code: "NOT_FOUND", message: "视频脚本不存在" });
      }
      return { ok: true };
    }),

  bridgeLastFrame: protectedProcedure
    .input(bridgeMediaVideoScriptFrameSchema)
    .mutation(async ({ ctx, input }) => {
      const script = await ctx.db.query.mediaVideoScript.findFirst({
        where: and(
          eq(mediaVideoScript.id, input.id),
          eq(mediaVideoScript.createdBy, ctx.session.user.id),
          isNull(mediaVideoScript.deletedAt),
        ),
      });
      if (!script) {
        throw new TRPCError({ code: "NOT_FOUND", message: "视频脚本不存在" });
      }
      if (script.version !== input.version) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "脚本已在其他页面更新，请刷新后重试",
        });
      }
      const sourceIndex = script.shots.findIndex(
        (shot) => shot.id === input.sourceShotId,
      );
      const targetShot = script.shots[sourceIndex + 1];
      if (sourceIndex < 0 || !targetShot) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "只能把已生成镜头的末帧接到它的下一镜",
        });
      }
      const sourceJob = await ctx.db.query.mediaGenerationJob.findFirst({
        where: and(
          eq(mediaGenerationJob.scriptId, script.id),
          eq(mediaGenerationJob.scriptShotId, input.sourceShotId),
          eq(mediaGenerationJob.createdBy, ctx.session.user.id),
          eq(mediaGenerationJob.status, "succeeded"),
        ),
        orderBy: desc(mediaGenerationJob.createdAt),
      });
      if (!sourceJob?.outputStorageKey) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "这个镜头还没有可用的成功成片",
        });
      }
      const sourceVideo = await getMediaHubObject(sourceJob.outputStorageKey);
      const finalFrame = await extractMediaGenerationLastFrame(sourceVideo);
      const assetId = crypto.randomUUID();
      const storageKey = `media-hub/image/${ctx.session.user.id}/${assetId}.png`;
      const now = new Date();
      const nextShots = script.shots.map((shot) =>
        shot.id === targetShot.id
          ? { ...shot, firstFrameAssetId: assetId }
          : shot,
      );
      await putMediaHubObject(storageKey, finalFrame, "image/png");
      try {
        let updated: typeof mediaVideoScript.$inferSelect | undefined;
        await ctx.db.transaction(async (transaction) => {
          await transaction.insert(mediaImageAsset).values({
            id: assetId,
            storageKey,
            filename: `${script.title}-${sourceIndex + 1}-末帧.png`.slice(
              0,
              255,
            ),
            contentType: "image/png",
            width: script.width,
            height: script.height,
            sizeBytes: finalFrame.length,
            checksum: `sha256:${createHash("sha256").update(finalFrame).digest("hex")}`,
            origin: "video-frame",
            ownerUserId: ctx.session.user.id,
            createdAt: now,
          });
          const [row] = await transaction
            .update(mediaVideoScript)
            .set({
              shots: nextShots,
              status: "ready",
              version: script.version + 1,
              updatedAt: now,
            })
            .where(
              and(
                eq(mediaVideoScript.id, script.id),
                eq(mediaVideoScript.createdBy, ctx.session.user.id),
                eq(mediaVideoScript.version, script.version),
                isNull(mediaVideoScript.deletedAt),
              ),
            )
            .returning();
          if (!row) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "脚本已在其他页面更新，请刷新后重试",
            });
          }
          updated = row;
        });
        if (!updated) throw new Error("末帧接力保存失败");
        return {
          ...scriptSummary(updated),
          bridgedAsset: {
            id: assetId,
            targetShotId: targetShot.id,
            url: `/api/media-hub/images/${encodeURIComponent(assetId)}`,
          },
        };
      } catch (error) {
        await deleteMediaHubObject(storageKey).catch(() => undefined);
        throw error;
      }
    }),

  generate: protectedProcedure
    .input(generateMediaVideoScriptSchema)
    .mutation(async ({ ctx, input }) => {
      startMediaGenerationScheduler();
      const script = await ctx.db.query.mediaVideoScript.findFirst({
        where: and(
          eq(mediaVideoScript.id, input.id),
          eq(mediaVideoScript.createdBy, ctx.session.user.id),
          isNull(mediaVideoScript.deletedAt),
        ),
      });
      if (!script) {
        throw new TRPCError({ code: "NOT_FOUND", message: "视频脚本不存在" });
      }
      const requestedIds = new Set(input.shotIds);
      const shots =
        requestedIds.size > 0
          ? script.shots.filter((shot) => requestedIds.has(shot.id))
          : script.shots;
      if (
        shots.length === 0 ||
        (shots.length !== requestedIds.size && requestedIds.size > 0)
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "请选择脚本中存在的镜头",
        });
      }
      const settings = await resolveMediaSystemSetting();
      const profileId =
        input.h3Profile ??
        script.defaultProfile ??
        settings.h3GenerationProfile;
      const profile = await requireH3Profile(profileId, "generate");
      const assetById = await requireOwnedFirstFrameAssets(
        ctx.db,
        ctx.session.user.id,
        shots,
      );
      const now = new Date();
      const rows = shots.map((shot) => {
        const prompt = compileVideoScriptShotPrompt(
          shot,
          script.continuityBible,
        );
        const issues = validateH3GenerationPrompt(prompt, shot.durationSeconds);
        if (issues.length > 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `镜头“${shot.title}”预检失败：${issues.join("；")}`,
          });
        }
        const sourceAsset = shot.firstFrameAssetId
          ? assetById.get(shot.firstFrameAssetId)
          : undefined;
        const shotIndex = script.shots.findIndex(
          (candidate) => candidate.id === shot.id,
        );
        return {
          id: crypto.randomUUID(),
          scriptId: script.id,
          scriptShotId: shot.id,
          prompt,
          title:
            `${script.title} / ${String(shotIndex + 1).padStart(2, "0")} ${shot.title}`.slice(
              0,
              200,
            ),
          language: script.language,
          sourceImageStorageKey: sourceAsset?.storageKey,
          sourceImageName: sourceAsset?.filename,
          sourceImageContentType: sourceAsset?.contentType,
          referenceImages: [],
          inputImageAssetIds: sourceAsset ? [sourceAsset.id] : [],
          durationSeconds: shot.durationSeconds,
          fps: 24,
          width: script.width,
          height: script.height,
          qualityPreset: input.qualityPreset,
          steps: Math.max(
            h3StepsForPreset(input.qualityPreset),
            profile.minimumSteps ?? 1,
          ),
          seed: randomInt(0, 2_147_483_643),
          profile: profileId,
          status: "queued",
          createdBy: ctx.session.user.id,
          createdAt: now,
          updatedAt: now,
        };
      });
      await ctx.db.transaction(async (transaction) => {
        await transaction.insert(mediaGenerationJob).values(rows);
        await transaction
          .update(mediaVideoScript)
          .set({ status: "production", updatedAt: now })
          .where(eq(mediaVideoScript.id, script.id));
      });
      rows.forEach((row) => scheduleMediaGenerationJob(row.id, null));
      return {
        scriptId: script.id,
        jobs: rows.map((row) => ({
          id: row.id,
          scriptShotId: row.scriptShotId,
          status: row.status,
        })),
      };
    }),
} satisfies TRPCRouterRecord;
