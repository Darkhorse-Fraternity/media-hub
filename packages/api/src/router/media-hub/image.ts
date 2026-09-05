import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";

import type { db as database } from "@acme/db/client";
import { and, desc, eq, inArray, isNull } from "@acme/db";
import { mediaImageAsset, mediaImageJob } from "@acme/db/schema";
import {
  createMediaImageJobSchema,
  mediaImageIdSchema,
  mediaImageListSchema,
  prepareMediaImageVideoInputsSchema,
} from "@acme/validators";

import { protectedProcedure } from "../../trpc";
import { canAccessMediaImageAsset } from "./image-access";
import {
  cancelMediaImageJob,
  getMediaImageProviderHealth,
  scheduleMediaImageJob,
  startMediaImageScheduler,
} from "./image-generation";
import { queueMediaImageJob } from "./image-job-service";

startMediaImageScheduler();

function assertUniqueAssetIds(assetIds: string[]): string[] {
  const unique = [...new Set(assetIds)];
  if (unique.length !== assetIds.length) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "不能重复选择同一张图片",
    });
  }
  return unique;
}

async function requireOwnedAssets(
  db: typeof database,
  ownerUserId: string,
  assetIds: string[],
) {
  const uniqueIds = assertUniqueAssetIds(assetIds);
  if (uniqueIds.length === 0) return [];
  const assets = await db.query.mediaImageAsset.findMany({
    where: and(
      inArray(mediaImageAsset.id, uniqueIds),
      eq(mediaImageAsset.ownerUserId, ownerUserId),
      isNull(mediaImageAsset.deletedAt),
    ),
  });
  if (assets.length !== uniqueIds.length) {
    throw new TRPCError({ code: "NOT_FOUND", message: "图片素材不存在" });
  }
  if (
    assets.some(
      (asset) =>
        !canAccessMediaImageAsset({
          actorUserId: ownerUserId,
          ownerUserId: asset.ownerUserId,
        }),
    )
  ) {
    throw new TRPCError({ code: "NOT_FOUND", message: "图片素材不存在" });
  }
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  return uniqueIds.map((id) => {
    const asset = byId.get(id);
    if (!asset) {
      throw new TRPCError({ code: "NOT_FOUND", message: "图片素材不存在" });
    }
    return asset;
  });
}

export const mediaImageRouter = {
  providerHealth: protectedProcedure.query(() => getMediaImageProviderHealth()),

  create: protectedProcedure
    .input(createMediaImageJobSchema)
    .mutation(async ({ ctx, input }) => {
      startMediaImageScheduler();
      const assets = await requireOwnedAssets(
        ctx.db,
        ctx.session.user.id,
        input.inputAssetIds,
      );
      return queueMediaImageJob({
        db: ctx.db,
        userId: ctx.session.user.id,
        ...input,
        inputAssetIds: assets.map((asset) => asset.id),
      });
    }),

  list: protectedProcedure
    .input(mediaImageListSchema)
    .query(async ({ ctx, input }) => {
      const [jobs, assets] = await Promise.all([
        ctx.db.query.mediaImageJob.findMany({
          where: eq(mediaImageJob.createdBy, ctx.session.user.id),
          orderBy: desc(mediaImageJob.createdAt),
          limit: input.limit,
        }),
        ctx.db.query.mediaImageAsset.findMany({
          where: and(
            eq(mediaImageAsset.ownerUserId, ctx.session.user.id),
            isNull(mediaImageAsset.deletedAt),
          ),
          orderBy: desc(mediaImageAsset.createdAt),
          limit: input.limit,
        }),
      ]);
      return {
        jobs,
        assets: assets.map((asset) => ({
          ...asset,
          url: `/api/media-hub/images/${encodeURIComponent(asset.id)}`,
        })),
      };
    }),

  prepareVideoInputs: protectedProcedure
    .input(prepareMediaImageVideoInputsSchema)
    .query(async ({ ctx, input }) => {
      const assets = await requireOwnedAssets(
        ctx.db,
        ctx.session.user.id,
        input.assetIds,
      );
      return assets.map((asset) => ({
        id: asset.id,
        name: asset.filename,
        contentType: asset.contentType as
          | "image/jpeg"
          | "image/png"
          | "image/webp",
        sizeBytes: asset.sizeBytes,
        url: `/api/media-hub/images/${encodeURIComponent(asset.id)}`,
      }));
    }),

  retry: protectedProcedure
    .input(mediaImageIdSchema)
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db
        .update(mediaImageJob)
        .set({
          status: "queued",
          providerJobId: null,
          errorMessage: null,
          startedAt: null,
          finishedAt: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(mediaImageJob.id, input.id),
            eq(mediaImageJob.createdBy, ctx.session.user.id),
            eq(mediaImageJob.status, "failed"),
          ),
        )
        .returning({ id: mediaImageJob.id });
      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "失败任务不存在" });
      }
      scheduleMediaImageJob(updated.id);
      return { ok: true };
    }),

  cancel: protectedProcedure
    .input(mediaImageIdSchema)
    .mutation(async ({ ctx, input }) => {
      const job = await ctx.db.query.mediaImageJob.findFirst({
        where: and(
          eq(mediaImageJob.id, input.id),
          eq(mediaImageJob.createdBy, ctx.session.user.id),
        ),
      });
      if (!job) {
        throw new TRPCError({ code: "NOT_FOUND", message: "图片任务不存在" });
      }
      if (!["queued", "running"].includes(job.status)) {
        throw new TRPCError({ code: "CONFLICT", message: "任务当前不可取消" });
      }
      await cancelMediaImageJob(job.id);
      return { ok: true };
    }),

  deleteAsset: protectedProcedure
    .input(mediaImageIdSchema)
    .mutation(async ({ ctx, input }) => {
      const [asset] = await ctx.db
        .update(mediaImageAsset)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(mediaImageAsset.id, input.id),
            eq(mediaImageAsset.ownerUserId, ctx.session.user.id),
            isNull(mediaImageAsset.deletedAt),
          ),
        )
        .returning({ id: mediaImageAsset.id });
      if (!asset) {
        throw new TRPCError({ code: "NOT_FOUND", message: "图片素材不存在" });
      }
      return { ok: true };
    }),
} satisfies TRPCRouterRecord;
