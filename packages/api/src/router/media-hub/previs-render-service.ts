import type { z } from "zod/v4";
import { TRPCError } from "@trpc/server";

import type { db as applicationDb } from "@acme/db/client";
import type { MediaPrevisRenderSpec } from "@acme/db/schema";
import type {
  changeMediaPrevisRenderSchema,
  importMediaPrevisImagesSchema,
  MediaPrevisRenderInput,
} from "@acme/validators";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  or,
  sql,
} from "@acme/db";
import {
  mediaImageAsset,
  mediaPrevisArtifact,
  mediaPrevisRender,
  mediaPrevisRenderAttempt,
  mediaPrevisRenderItem,
  mediaPrevisRequest,
  mediaPrevisRevision,
  mediaPrevisScene,
  user,
} from "@acme/db/schema";
import {
  createMediaPrevisRenderSchema,
  MEDIA_PREVIS_ENGINE_VERSION,
  mediaPrevisRecipeSchema,
} from "@acme/validators";

import { h3ReferenceFrameCount } from "./h3-reference-video";
import { previsChecksum } from "./previs-document";

type Database = typeof applicationDb;
type Reader = Pick<Database, "select">;
const missing = () =>
  new TRPCError({ code: "NOT_FOUND", message: "白模资源不存在" });

export function assertPrevisEnabled() {
  if (process.env.MEDIA_HUB_PREVIS_ENABLED === "false")
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "白模工作台已暂停",
    });
}

export async function ownedPrevisRender(
  database: Reader,
  owner: string,
  renderId: string,
) {
  const [render] = await database
    .select()
    .from(mediaPrevisRender)
    .where(
      and(
        eq(mediaPrevisRender.id, renderId),
        eq(mediaPrevisRender.ownerUserId, owner),
      ),
    )
    .limit(1);
  if (!render) throw missing();
  return render;
}

export async function ownedPrevisArtifact(
  database: Reader,
  owner: string,
  artifactId: string,
) {
  const [row] = await database
    .select({
      artifact: mediaPrevisArtifact,
      item: mediaPrevisRenderItem,
      render: mediaPrevisRender,
    })
    .from(mediaPrevisArtifact)
    .innerJoin(
      mediaPrevisRenderItem,
      eq(mediaPrevisArtifact.itemId, mediaPrevisRenderItem.id),
    )
    .innerJoin(
      mediaPrevisRender,
      eq(mediaPrevisRenderItem.renderId, mediaPrevisRender.id),
    )
    .where(
      and(
        eq(mediaPrevisArtifact.id, artifactId),
        eq(mediaPrevisRender.ownerUserId, owner),
        eq(mediaPrevisRenderItem.status, "succeeded"),
      ),
    )
    .limit(1);
  if (!row) throw missing();
  return row;
}

export function resolvePrevisRenderSpecs(
  input: MediaPrevisRenderInput,
  revision: typeof mediaPrevisRevision.$inferSelect,
): MediaPrevisRenderSpec[] {
  if (revision.engineVersion !== MEDIA_PREVIS_ENGINE_VERSION)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "场景引擎版本需要迁移",
    });
  const recipe = mediaPrevisRecipeSchema.parse(revision.recipe);
  const views = input.viewIds.length
    ? input.viewIds.map((id) => {
        const view = revision.views.find((view) => view.id === id);
        if (!view)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `视图不存在：${id}`,
          });
        return { id: view.id, camera: view.camera };
      })
    : [{ id: null, camera: null }];
  const frameCount =
    input.outputType === "image"
      ? 1
      : input.profile === "h3_reference"
        ? h3ReferenceFrameCount(input.durationSeconds)
        : Math.max(1, Math.round(input.durationSeconds * input.fps));
  const duration = input.outputType === "image" ? 0 : frameCount / input.fps;
  const specs = views.flatMap((view) =>
    (input.outputType === "image" ? input.frames : [null]).map((frame) => ({
      outputType: input.outputType,
      profile: input.profile,
      viewId: view.id,
      camera: view.camera,
      sampleTime:
        input.outputType === "image" && frame !== null
          ? (frame - 1) / input.timelineFps
          : input.startSeconds,
      frame,
      width: input.width,
      height: input.height,
      fps: input.fps,
      frameCount,
      nominalDurationSeconds:
        input.outputType === "image" ? 0 : input.durationSeconds,
      durationSeconds: duration,
      engineVersion: revision.engineVersion,
    })),
  );
  for (const spec of specs) {
    const lastSample =
      spec.sampleTime +
      (input.outputType === "video" ? (frameCount - 1) / input.fps : 0);
    const allowedEnd = recipe.motion?.duration ?? 30;
    // H3's frame grid may extend past the nominal end; the worker explicitly holds the final pose.
    const padding =
      input.profile === "h3_reference"
        ? Math.max(0, duration - input.durationSeconds)
        : 0;
    if (
      lastSample > 30 ||
      (recipe.motion &&
        !recipe.motion.loop &&
        lastSample > allowedEnd + padding + 1e-6)
    )
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "采样范围超出场景动作时长",
      });
  }
  return specs;
}

export async function createPrevisRender(
  database: Database,
  owner: string,
  input: MediaPrevisRenderInput,
  purpose: "render" | "thumbnail" = "render",
) {
  assertPrevisEnabled();
  const { idempotencyKey, ...request } = input;
  const requestHash = previsChecksum(request);
  return database.transaction(async (tx) => {
    // Serialize admissions while allowing revision inserts to check the user FK.
    await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, owner))
      .for("no key update");
    if (idempotencyKey) {
      const [mutationKey] = await tx
        .select({ id: mediaPrevisRequest.id })
        .from(mediaPrevisRequest)
        .where(
          and(
            eq(mediaPrevisRequest.ownerUserId, owner),
            eq(mediaPrevisRequest.key, idempotencyKey),
          ),
        )
        .limit(1);
      if (mutationKey)
        throw new TRPCError({
          code: "CONFLICT",
          message: "Idempotency-Key 已用于其他白模请求",
        });
      const [existing] = await tx
        .select()
        .from(mediaPrevisRender)
        .where(
          and(
            eq(mediaPrevisRender.ownerUserId, owner),
            eq(mediaPrevisRender.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);
      if (existing) {
        if (existing.requestHash !== requestHash)
          throw new TRPCError({
            code: "CONFLICT",
            message: "Idempotency-Key 已用于不同的渲染请求",
          });
        return existing;
      }
    }
    const [source] = await tx
      .select({ scene: mediaPrevisScene, revision: mediaPrevisRevision })
      .from(mediaPrevisScene)
      .innerJoin(
        mediaPrevisRevision,
        eq(mediaPrevisRevision.sceneId, mediaPrevisScene.id),
      )
      .where(
        and(
          eq(mediaPrevisScene.id, input.id),
          eq(mediaPrevisScene.ownerUserId, owner),
          eq(mediaPrevisRevision.id, input.revisionId),
        ),
      )
      .limit(1);
    if (!source) throw missing();
    if (purpose === "thumbnail") {
      if (
        source.scene.headRevisionId !== input.revisionId ||
        source.scene.thumbnailMode !== "auto"
      )
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "请为当前版本启用自动缩略图",
        });
      const [existing] = await tx
        .select()
        .from(mediaPrevisRender)
        .where(
          and(
            eq(mediaPrevisRender.revisionId, input.revisionId),
            eq(mediaPrevisRender.purpose, "thumbnail"),
          ),
        )
        .limit(1);
      if (existing) return existing;
    }
    if (source.scene.archivedAt)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "请先恢复已归档的场景",
      });
    const specs = resolvePrevisRenderSpecs(input, source.revision);
    const [active] = await tx
      .select({ total: count() })
      .from(mediaPrevisRenderItem)
      .innerJoin(
        mediaPrevisRender,
        eq(mediaPrevisRenderItem.renderId, mediaPrevisRender.id),
      )
      .where(
        and(
          eq(mediaPrevisRender.ownerUserId, owner),
          inArray(mediaPrevisRenderItem.status, ["queued", "running"]),
        ),
      );
    if ((active?.total ?? 0) + specs.length > 128)
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "白模待处理条目已达 128 项上限",
      });
    const [usage] = await tx
      .select({
        bytes: sql<string>`coalesce(sum(${mediaPrevisArtifact.sizeBytes}), 0)`,
      })
      .from(mediaPrevisArtifact)
      .innerJoin(
        mediaPrevisRenderItem,
        eq(mediaPrevisArtifact.itemId, mediaPrevisRenderItem.id),
      )
      .innerJoin(
        mediaPrevisRender,
        eq(mediaPrevisRenderItem.renderId, mediaPrevisRender.id),
      )
      .where(eq(mediaPrevisRender.ownerUserId, owner));
    // Reserve the maximum output budget of every outstanding item (50 MB).
    if (
      Number(usage?.bytes ?? 0) +
        ((active?.total ?? 0) + specs.length) * 50_000_000 >
      8_000_000_000
    )
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "白模产物达到 8 GB 配额",
      });
    const id = crypto.randomUUID();
    const [render] = await tx
      .insert(mediaPrevisRender)
      .values({
        id,
        sceneId: input.id,
        revisionId: input.revisionId,
        ownerUserId: owner,
        idempotencyKey,
        requestHash,
        purpose,
        request,
      })
      .returning();
    await tx.insert(mediaPrevisRenderItem).values(
      specs.map((spec, position) => ({
        id: crypto.randomUUID(),
        renderId: id,
        spec,
        position,
      })),
    );
    if (!render) throw new Error("渲染批次保存失败");
    return render;
  });
}

/** Internal thumbnails share the renderer, quotas, cancellation and attempt fencing. */
export async function requestPrevisThumbnail(
  database: Database,
  owner: string,
  sceneId: string,
  retry = false,
) {
  const [scene] = await database
    .select()
    .from(mediaPrevisScene)
    .where(
      and(
        eq(mediaPrevisScene.id, sceneId),
        eq(mediaPrevisScene.ownerUserId, owner),
      ),
    )
    .limit(1);
  if (!scene?.headRevisionId) throw missing();
  const render = await createPrevisRender(
    database,
    owner,
    createMediaPrevisRenderSchema.parse({
      id: scene.id,
      revisionId: scene.headRevisionId,
      outputType: "image",
      profile: "preview",
      width: 320,
      height: 180,
    }),
    "thumbnail",
  );
  const [artifact] = await database
    .select({ artifact: mediaPrevisArtifact })
    .from(mediaPrevisArtifact)
    .innerJoin(
      mediaPrevisRenderItem,
      eq(mediaPrevisArtifact.itemId, mediaPrevisRenderItem.id),
    )
    .where(eq(mediaPrevisRenderItem.renderId, render.id))
    .limit(1);
  if (artifact)
    await database
      .update(mediaPrevisScene)
      .set({
        thumbnailArtifactId: artifact.artifact.id,
        thumbnailRevisionId: render.revisionId,
      })
      .where(
        and(
          eq(mediaPrevisScene.id, scene.id),
          eq(mediaPrevisScene.ownerUserId, owner),
          eq(mediaPrevisScene.thumbnailMode, "auto"),
          eq(mediaPrevisScene.headRevisionId, render.revisionId),
        ),
      );
  if (retry)
    await changePrevisRender(database, owner, { renderId: render.id }, "retry");
  return getPrevisRender(database, owner, render.id);
}

/** Queue at most one missing cover when the render worker is idle. */
export async function queuePrevisThumbnail(database: Database) {
  let afterId: string | undefined;
  for (;;) {
    const candidates: { id: string; owner: string }[] = await database
      .select({ id: mediaPrevisScene.id, owner: mediaPrevisScene.ownerUserId })
      .from(mediaPrevisScene)
      .innerJoin(
        mediaPrevisRevision,
        eq(mediaPrevisRevision.id, mediaPrevisScene.headRevisionId),
      )
      .leftJoin(
        mediaPrevisRender,
        and(
          eq(mediaPrevisRender.revisionId, mediaPrevisScene.headRevisionId),
          eq(mediaPrevisRender.purpose, "thumbnail"),
        ),
      )
      .leftJoin(
        mediaPrevisRenderItem,
        eq(mediaPrevisRenderItem.renderId, mediaPrevisRender.id),
      )
      .leftJoin(
        mediaPrevisArtifact,
        eq(mediaPrevisArtifact.itemId, mediaPrevisRenderItem.id),
      )
      .where(
        and(
          afterId === undefined ? undefined : gt(mediaPrevisScene.id, afterId),
          eq(mediaPrevisRevision.engineVersion, MEDIA_PREVIS_ENGINE_VERSION),
          isNull(mediaPrevisScene.archivedAt),
          eq(mediaPrevisScene.thumbnailMode, "auto"),
          or(
            isNull(mediaPrevisRender.id),
            eq(mediaPrevisRenderItem.status, "succeeded"),
          ),
          or(
            isNull(mediaPrevisScene.thumbnailRevisionId),
            sql`${mediaPrevisScene.thumbnailRevisionId} <> ${mediaPrevisScene.headRevisionId}`,
            sql`${mediaPrevisScene.thumbnailArtifactId} is distinct from ${mediaPrevisArtifact.id}`,
          ),
        ),
      )
      .orderBy(asc(mediaPrevisScene.id))
      .limit(10);
    for (const { id, owner } of candidates) {
      try {
        await requestPrevisThumbnail(database, owner, id);
        return true;
      } catch (error) {
        if (
          !(error instanceof TRPCError) ||
          !["TOO_MANY_REQUESTS", "PRECONDITION_FAILED", "NOT_FOUND"].includes(
            error.code,
          )
        )
          throw error;
      }
    }
    const last = candidates.at(-1);
    if (candidates.length < 10 || !last) return false;
    afterId = last.id;
  }
}

export async function getPrevisRender(
  database: Database,
  owner: string,
  renderId: string,
) {
  const render = await ownedPrevisRender(database, owner, renderId);
  const groups = await database
    .select({ status: mediaPrevisRenderItem.status, count: count() })
    .from(mediaPrevisRenderItem)
    .where(eq(mediaPrevisRenderItem.renderId, renderId))
    .groupBy(mediaPrevisRenderItem.status);
  const counts = Object.fromEntries(
    groups.map((group) => [group.status, group.count]),
  );
  const total = groups.reduce((sum, group) => sum + group.count, 0);
  const pending = (counts.queued ?? 0) + (counts.running ?? 0);
  const status = pending
    ? counts.running
      ? "running"
      : "queued"
    : counts.succeeded === total
      ? "succeeded"
      : counts.canceled === total
        ? "canceled"
        : counts.succeeded
          ? "partial"
          : "failed";
  return { ...render, status, counts, total, completed: total - pending };
}

export async function listPrevisRenders(
  database: Database,
  owner: string,
  input: { id: string; page: number; pageSize: number },
) {
  const [scene] = await database
    .select({ id: mediaPrevisScene.id })
    .from(mediaPrevisScene)
    .where(
      and(
        eq(mediaPrevisScene.id, input.id),
        eq(mediaPrevisScene.ownerUserId, owner),
      ),
    )
    .limit(1);
  if (!scene) throw missing();
  const where = and(
    eq(mediaPrevisRender.sceneId, scene.id),
    eq(mediaPrevisRender.ownerUserId, owner),
    eq(mediaPrevisRender.purpose, "render"),
  );
  const renders = await database
    .select()
    .from(mediaPrevisRender)
    .where(where)
    .orderBy(desc(mediaPrevisRender.createdAt), desc(mediaPrevisRender.id))
    .limit(input.pageSize)
    .offset((input.page - 1) * input.pageSize);
  const [total] = await database
    .select({ total: count() })
    .from(mediaPrevisRender)
    .where(where);
  return {
    items: await Promise.all(
      renders.map((render) => getPrevisRender(database, owner, render.id)),
    ),
    total: total?.total ?? 0,
    page: input.page,
    pageSize: input.pageSize,
  };
}

export async function listPrevisRenderItems(
  database: Database,
  owner: string,
  input: { renderId: string; page: number; pageSize: number },
) {
  const render = await getPrevisRender(database, owner, input.renderId);
  const items = await database
    .select()
    .from(mediaPrevisRenderItem)
    .where(eq(mediaPrevisRenderItem.renderId, render.id))
    .orderBy(mediaPrevisRenderItem.position)
    .limit(input.pageSize)
    .offset((input.page - 1) * input.pageSize);
  const ids = items.map((item) => item.id);
  const artifacts = ids.length
    ? await database
        .select()
        .from(mediaPrevisArtifact)
        .where(inArray(mediaPrevisArtifact.itemId, ids))
    : [];
  const attempts = ids.length
    ? await database
        .select()
        .from(mediaPrevisRenderAttempt)
        .where(inArray(mediaPrevisRenderAttempt.itemId, ids))
        .orderBy(mediaPrevisRenderAttempt.number)
    : [];
  return {
    items: items.map((item) => ({
      ...item,
      attempts: attempts.filter((attempt) => attempt.itemId === item.id),
      artifact:
        artifacts.find((artifact) => artifact.itemId === item.id) ?? null,
    })),
    total: render.total,
    page: input.page,
    pageSize: input.pageSize,
  };
}

export async function changePrevisRender(
  database: Database,
  owner: string,
  input: z.infer<typeof changeMediaPrevisRenderSchema>,
  action: "cancel" | "retry",
) {
  assertPrevisEnabled();
  await database.transaction(async (tx) => {
    await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, owner))
      .for("no key update");
    await ownedPrevisRender(tx, owner, input.renderId);
    const items = await tx
      .select()
      .from(mediaPrevisRenderItem)
      .where(
        and(
          eq(mediaPrevisRenderItem.renderId, input.renderId),
          input.itemIds
            ? inArray(mediaPrevisRenderItem.id, input.itemIds)
            : undefined,
        ),
      )
      .orderBy(mediaPrevisRenderItem.position)
      .for("update");
    if (input.itemIds && new Set(input.itemIds).size !== items.length)
      throw missing();
    const targets = items.filter((item) =>
      action === "cancel"
        ? ["queued", "running"].includes(item.status)
        : ["failed", "interrupted", "canceled"].includes(item.status),
    );
    if (action === "retry") {
      const [active] = await tx
        .select({ total: count() })
        .from(mediaPrevisRenderItem)
        .innerJoin(
          mediaPrevisRender,
          eq(mediaPrevisRenderItem.renderId, mediaPrevisRender.id),
        )
        .where(
          and(
            eq(mediaPrevisRender.ownerUserId, owner),
            inArray(mediaPrevisRenderItem.status, ["queued", "running"]),
          ),
        );
      if ((active?.total ?? 0) + targets.length > 128)
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "白模待处理条目已达上限",
        });
      if (targets.some((item) => item.attemptNumber >= 10))
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "每个条目最多执行 10 次，请新建批次",
        });
      const [usage] = await tx
        .select({
          bytes: sql<string>`coalesce(sum(${mediaPrevisArtifact.sizeBytes}), 0)`,
        })
        .from(mediaPrevisArtifact)
        .innerJoin(
          mediaPrevisRenderItem,
          eq(mediaPrevisArtifact.itemId, mediaPrevisRenderItem.id),
        )
        .innerJoin(
          mediaPrevisRender,
          eq(mediaPrevisRenderItem.renderId, mediaPrevisRender.id),
        )
        .where(eq(mediaPrevisRender.ownerUserId, owner));
      if (
        Number(usage?.bytes ?? 0) +
          ((active?.total ?? 0) + targets.length) * 50_000_000 >
        8_000_000_000
      )
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "白模产物达到 8 GB 配额",
        });
    }
    for (const item of targets) {
      await tx
        .update(mediaPrevisRenderItem)
        .set(
          action === "retry"
            ? {
                status: "queued",
                currentAttemptId: null,
                error: null,
                cancelRequestedAt: null,
                updatedAt: new Date(),
              }
            : item.status === "running"
              ? { cancelRequestedAt: new Date(), updatedAt: new Date() }
              : {
                  status: "canceled",
                  cancelRequestedAt: new Date(),
                  updatedAt: new Date(),
                },
        )
        .where(eq(mediaPrevisRenderItem.id, item.id));
    }
  });
  return getPrevisRender(database, owner, input.renderId);
}

export async function importPrevisImages(
  database: Database,
  owner: string,
  input: z.infer<typeof importMediaPrevisImagesSchema>,
) {
  await ownedPrevisRender(database, owner, input.renderId);
  if (new Set(input.artifactIds).size !== input.artifactIds.length)
    throw new TRPCError({ code: "BAD_REQUEST", message: "产物不能重复" });
  return database.transaction(async (tx) => {
    const assets = [];
    for (const id of [...input.artifactIds].sort()) {
      const owned = await ownedPrevisArtifact(tx, owner, id);
      if (
        owned.render.id !== input.renderId ||
        owned.artifact.contentType !== "image/png"
      )
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "只能导入本批次的 PNG 产物",
        });
      const [artifact] = await tx
        .select()
        .from(mediaPrevisArtifact)
        .where(eq(mediaPrevisArtifact.id, id))
        .for("update");
      if (!artifact) throw missing();
      if (artifact.imageAssetId) {
        // Re-import restores the same asset if it was hidden from the library.
        await tx
          .update(mediaImageAsset)
          .set({ deletedAt: null })
          .where(
            and(
              eq(mediaImageAsset.id, artifact.imageAssetId),
              eq(mediaImageAsset.ownerUserId, owner),
            ),
          );
        assets.push({ artifactId: id, assetId: artifact.imageAssetId });
        continue;
      }
      const assetId = crypto.randomUUID();
      await tx.insert(mediaImageAsset).values({
        id: assetId,
        storageKey: artifact.storageKey,
        filename: `白模-${owned.item.position + 1}.png`,
        contentType: "image/png",
        width: artifact.width,
        height: artifact.height,
        sizeBytes: artifact.sizeBytes,
        checksum: artifact.checksum,
        origin: "previs",
        ownerUserId: owner,
      });
      await tx
        .update(mediaPrevisArtifact)
        .set({ imageAssetId: assetId })
        .where(eq(mediaPrevisArtifact.id, id));
      assets.push({ artifactId: id, assetId });
    }
    return { assets };
  });
}
