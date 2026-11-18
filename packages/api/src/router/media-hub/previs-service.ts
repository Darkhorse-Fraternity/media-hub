import type { z } from "zod/v4";
import { TRPCError } from "@trpc/server";

import type { db as applicationDb } from "@acme/db/client";
import type {
  createMediaPrevisRevisionSchema,
  createMediaPrevisSceneSchema,
  forkMediaPrevisSceneSchema,
  listMediaPrevisRevisionsSchema,
  listMediaPrevisScenesSchema,
  updateMediaPrevisSceneSchema,
} from "@acme/validators";
import { and, count, desc, eq, isNull, like, lte, or } from "@acme/db";
import {
  mediaPrevisArtifact,
  mediaPrevisRender,
  mediaPrevisRenderItem,
  mediaPrevisRequest,
  mediaPrevisRevision,
  mediaPrevisScene,
  user,
} from "@acme/db/schema";
import { MEDIA_PREVIS_ENGINE_VERSION } from "@acme/validators";

import {
  compilePrevisDocument,
  emptyPrevisRecipe,
  previsChecksum,
} from "./previs-document";
import { requirePrevisGroup } from "./previs-group-service";

type Database = typeof applicationDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Reader = Pick<Database, "select">;
type Scene = typeof mediaPrevisScene.$inferSelect;
type Revision = typeof mediaPrevisRevision.$inferSelect;
interface MutationTarget {
  sceneId: string;
  revisionId: string;
}

const conflict = () =>
  new TRPCError({
    code: "CONFLICT",
    message: "白模场景已更新，请读取最新版本后重试",
  });

async function requireScene(
  database: Reader,
  userId: string,
  id: string,
  lock = false,
) {
  const query = database
    .select()
    .from(mediaPrevisScene)
    .where(
      and(
        eq(mediaPrevisScene.id, id),
        eq(mediaPrevisScene.ownerUserId, userId),
      ),
    )
    .limit(1);
  const [scene] = lock ? await query.for("update") : await query;
  if (!scene)
    throw new TRPCError({ code: "NOT_FOUND", message: "白模场景不存在" });
  return scene;
}

async function requireRevision(
  database: Reader,
  userId: string,
  revisionId: string,
  sceneId?: string,
) {
  const [row] = await database
    .select({ revision: mediaPrevisRevision })
    .from(mediaPrevisRevision)
    .innerJoin(
      mediaPrevisScene,
      eq(mediaPrevisRevision.sceneId, mediaPrevisScene.id),
    )
    .where(
      and(
        eq(mediaPrevisRevision.id, revisionId),
        eq(mediaPrevisScene.ownerUserId, userId),
        sceneId === undefined
          ? undefined
          : eq(mediaPrevisRevision.sceneId, sceneId),
      ),
    )
    .limit(1);
  if (!row)
    throw new TRPCError({ code: "NOT_FOUND", message: "白模版本不存在" });
  return row.revision;
}

async function readDocument(
  database: Reader,
  userId: string,
  target: MutationTarget,
) {
  const scene = await requireScene(database, userId, target.sceneId);
  const revision = await requireRevision(
    database,
    userId,
    target.revisionId,
    scene.id,
  );
  return { scene, revision };
}

async function mutate(
  database: Database,
  userId: string,
  key: string | undefined,
  operation: string,
  request: unknown,
  change: (transaction: Transaction) => Promise<MutationTarget>,
) {
  const requestHash = previsChecksum({ operation, request });
  return database.transaction(async (transaction) => {
    let reservationId: string | undefined;
    if (key !== undefined) {
      await transaction
        .select({ id: user.id })
        .from(user)
        .where(eq(user.id, userId))
        .for("no key update");
      const [renderKey] = await transaction
        .select({ id: mediaPrevisRender.id })
        .from(mediaPrevisRender)
        .where(
          and(
            eq(mediaPrevisRender.ownerUserId, userId),
            eq(mediaPrevisRender.idempotencyKey, key),
          ),
        )
        .limit(1);
      if (renderKey)
        throw new TRPCError({
          code: "CONFLICT",
          message: "Idempotency-Key 已用于白模渲染请求",
        });
      const [reservation] = await transaction
        .insert(mediaPrevisRequest)
        .values({
          id: crypto.randomUUID(),
          ownerUserId: userId,
          key,
          operation,
          requestHash,
        })
        .onConflictDoNothing({
          target: [mediaPrevisRequest.ownerUserId, mediaPrevisRequest.key],
        })
        .returning();
      if (!reservation) {
        const [existing] = await transaction
          .select()
          .from(mediaPrevisRequest)
          .where(
            and(
              eq(mediaPrevisRequest.ownerUserId, userId),
              eq(mediaPrevisRequest.key, key),
            ),
          )
          .limit(1);
        if (
          existing?.requestHash !== requestHash ||
          existing.operation !== operation
        ) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Idempotency-Key 已用于不同的白模请求",
          });
        }
        if (!existing.sceneId || !existing.revisionId)
          throw new Error("白模幂等记录不完整");
        return readDocument(transaction, userId, {
          sceneId: existing.sceneId,
          revisionId: existing.revisionId,
        });
      }
      reservationId = reservation.id;
    }
    const target = await change(transaction);
    if (reservationId)
      await transaction
        .update(mediaPrevisRequest)
        .set(target)
        .where(eq(mediaPrevisRequest.id, reservationId));
    return readDocument(transaction, userId, target);
  });
}

async function insertScene(
  transaction: Transaction,
  userId: string,
  input: {
    title: string;
    description: string;
    groupId?: string | null;
    forkedFromRevisionId?: string;
  },
  document: Awaited<ReturnType<typeof compilePrevisDocument>>,
) {
  if (input.groupId)
    await requirePrevisGroup(transaction, userId, input.groupId);
  const sceneId = crypto.randomUUID();
  const revisionId = crypto.randomUUID();
  await transaction.insert(mediaPrevisScene).values({
    id: sceneId,
    ownerUserId: userId,
    title: input.title,
    description: input.description,
    groupId: input.groupId,
    forkedFromRevisionId: input.forkedFromRevisionId,
  });
  await transaction.insert(mediaPrevisRevision).values({
    id: revisionId,
    sceneId,
    revisionNumber: 1,
    ...document,
    createdBy: userId,
    message: input.forkedFromRevisionId ? "复制场景" : "初始版本",
  });
  await transaction
    .update(mediaPrevisScene)
    .set({ headRevisionId: revisionId, revisionCount: 1 })
    .where(eq(mediaPrevisScene.id, sceneId));
  return { sceneId, revisionId };
}

export async function createPrevisScene(
  database: Database,
  userId: string,
  input: z.infer<typeof createMediaPrevisSceneSchema>,
) {
  const { idempotencyKey, ...request } = input;
  const document = await compilePrevisDocument({
    recipe: input.recipe ?? emptyPrevisRecipe,
    views: input.views,
  });
  return mutate(
    database,
    userId,
    idempotencyKey,
    "create",
    request,
    (transaction) => insertScene(transaction, userId, input, document),
  );
}

export async function listPrevisScenes(
  database: Database,
  userId: string,
  input: z.infer<typeof listMediaPrevisScenesSchema>,
) {
  // Treat search text literally; '%' and '_' must not become wildcard queries.
  const escaped = input.search.replace(/[\\%_]/g, "\\$&");
  const where = and(
    eq(mediaPrevisScene.ownerUserId, userId),
    input.groupId === undefined
      ? undefined
      : input.groupId === null
        ? isNull(mediaPrevisScene.groupId)
        : eq(mediaPrevisScene.groupId, input.groupId),
    input.status === "active"
      ? isNull(mediaPrevisScene.archivedAt)
      : input.status === "archived"
        ? eq(isNull(mediaPrevisScene.archivedAt), false)
        : undefined,
    input.search
      ? or(
          like(mediaPrevisScene.title, `%${escaped}%`),
          like(mediaPrevisScene.description, `%${escaped}%`),
        )
      : undefined,
  );
  const [items, totals] = await Promise.all([
    database
      .select()
      .from(mediaPrevisScene)
      .where(where)
      .orderBy(desc(mediaPrevisScene.updatedAt), desc(mediaPrevisScene.id))
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize),
    database.select({ total: count() }).from(mediaPrevisScene).where(where),
  ]);
  return {
    items,
    total: totals[0]?.total ?? 0,
    page: input.page,
    pageSize: input.pageSize,
  };
}

export async function getPrevisScene(
  database: Database,
  userId: string,
  id: string,
) {
  const scene = await requireScene(database, userId, id);
  if (!scene.headRevisionId) throw new Error("白模场景没有初始版本");
  return {
    scene,
    revision: await requireRevision(database, userId, scene.headRevisionId, id),
  };
}

export async function getPrevisRevision(
  database: Database,
  userId: string,
  revisionId: string,
) {
  const revision = await requireRevision(database, userId, revisionId);
  return {
    scene: await requireScene(database, userId, revision.sceneId),
    revision,
  };
}

export async function updatePrevisScene(
  database: Database,
  userId: string,
  input: z.infer<typeof updateMediaPrevisSceneSchema>,
) {
  return database.transaction(async (transaction) => {
    // Keep group -> scene lock order consistent with group deletion.
    if (input.groupId)
      await requirePrevisGroup(transaction, userId, input.groupId);
    const scene = await requireScene(transaction, userId, input.id, true);
    if (scene.version !== input.version) throw conflict();
    let thumbnailRevisionId: string | null | undefined;
    if (input.thumbnailArtifactId) {
      const [cover] = await transaction
        .select({ revisionId: mediaPrevisArtifact.revisionId })
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
            eq(mediaPrevisArtifact.id, input.thumbnailArtifactId),
            eq(mediaPrevisRender.sceneId, scene.id),
            eq(mediaPrevisRender.ownerUserId, userId),
            eq(mediaPrevisArtifact.contentType, "image/png"),
          ),
        )
        .limit(1);
      if (!cover)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "该场景的缩略图产物不存在",
        });
      thumbnailRevisionId = cover.revisionId;
    } else if (input.thumbnailArtifactId === null) thumbnailRevisionId = null;
    if (input.headRevisionId !== undefined) {
      if (scene.headRevisionId !== input.expectedHeadRevisionId)
        throw conflict();
      await requireRevision(
        transaction,
        userId,
        input.headRevisionId,
        scene.id,
      );
    }
    const [updated] = await transaction
      .update(mediaPrevisScene)
      .set({
        title: input.title,
        description: input.description,
        groupId: input.groupId,
        thumbnailArtifactId: input.thumbnailArtifactId,
        thumbnailRevisionId,
        thumbnailMode:
          input.thumbnailArtifactId === undefined
            ? undefined
            : input.thumbnailArtifactId === null
              ? "auto"
              : "manual",
        archivedAt:
          input.archived === undefined
            ? undefined
            : input.archived
              ? (scene.archivedAt ?? new Date())
              : null,
        headRevisionId: input.headRevisionId,
        version: scene.version + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(mediaPrevisScene.id, scene.id),
          eq(mediaPrevisScene.version, input.version),
        ),
      )
      .returning();
    if (!updated?.headRevisionId) throw conflict();
    return readDocument(transaction, userId, {
      sceneId: updated.id,
      revisionId: updated.headRevisionId,
    });
  });
}

export async function createPrevisRevision(
  database: Database,
  userId: string,
  input: z.infer<typeof createMediaPrevisRevisionSchema>,
) {
  const parent = await requireRevision(
    database,
    userId,
    input.parentRevisionId,
    input.id,
  );
  if (parent.engineVersion !== MEDIA_PREVIS_ENGINE_VERSION) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "该白模版本需要先完成引擎版本迁移",
    });
  }
  const document = await compilePrevisDocument({
    recipe: input.recipe ?? parent.recipe,
    operations: input.operations,
    views: input.views ?? parent.views,
  });
  const { idempotencyKey, ...request } = input;
  return mutate(
    database,
    userId,
    idempotencyKey,
    "revision",
    request,
    async (transaction) => {
      const scene = await requireScene(transaction, userId, input.id, true);
      if (scene.archivedAt)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "请先恢复已归档的白模场景",
        });
      if (
        input.setCurrent &&
        scene.headRevisionId !== input.expectedHeadRevisionId
      )
        throw conflict();
      const revisionId = crypto.randomUUID();
      const revisionNumber = scene.revisionCount + 1;
      await transaction.insert(mediaPrevisRevision).values({
        id: revisionId,
        sceneId: scene.id,
        parentRevisionId: parent.id,
        revisionNumber,
        ...document,
        message: input.message,
        createdBy: userId,
      });
      await transaction
        .update(mediaPrevisScene)
        .set({
          revisionCount: revisionNumber,
          headRevisionId: input.setCurrent ? revisionId : undefined,
          version: scene.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(mediaPrevisScene.id, scene.id));
      return { sceneId: scene.id, revisionId };
    },
  );
}

export async function listPrevisRevisions(
  database: Database,
  userId: string,
  input: z.infer<typeof listMediaPrevisRevisionsSchema>,
) {
  const scene = await requireScene(database, userId, input.id);
  const items = await database
    .select({
      id: mediaPrevisRevision.id,
      sceneId: mediaPrevisRevision.sceneId,
      parentRevisionId: mediaPrevisRevision.parentRevisionId,
      revisionNumber: mediaPrevisRevision.revisionNumber,
      checksum: mediaPrevisRevision.checksum,
      engineVersion: mediaPrevisRevision.engineVersion,
      schemaVersion: mediaPrevisRevision.schemaVersion,
      message: mediaPrevisRevision.message,
      createdAt: mediaPrevisRevision.createdAt,
    })
    .from(mediaPrevisRevision)
    .where(
      and(
        eq(mediaPrevisRevision.sceneId, scene.id),
        lte(mediaPrevisRevision.revisionNumber, scene.revisionCount),
      ),
    )
    .orderBy(desc(mediaPrevisRevision.revisionNumber))
    .limit(input.pageSize)
    .offset((input.page - 1) * input.pageSize);
  return {
    items,
    total: scene.revisionCount,
    headRevisionId: scene.headRevisionId,
    page: input.page,
    pageSize: input.pageSize,
  };
}

export async function forkPrevisScene(
  database: Database,
  userId: string,
  input: z.infer<typeof forkMediaPrevisSceneSchema>,
) {
  const source = await requireScene(database, userId, input.id);
  const revision = await requireRevision(
    database,
    userId,
    input.revisionId,
    source.id,
  );
  if (revision.engineVersion !== MEDIA_PREVIS_ENGINE_VERSION) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "该白模版本需要先完成引擎版本迁移",
    });
  }
  const document = await compilePrevisDocument({
    recipe: revision.recipe,
    views: revision.views,
  });
  const { idempotencyKey, ...request } = input;
  return mutate(
    database,
    userId,
    idempotencyKey,
    "fork",
    request,
    (transaction) =>
      insertScene(
        transaction,
        userId,
        {
          title: input.title ?? `${source.title.slice(0, 195)} 副本`,
          description: source.description,
          groupId: source.groupId,
          forkedFromRevisionId: revision.id,
        },
        document,
      ),
  );
}

export type { Scene as MediaPrevisScene, Revision as MediaPrevisRevision };
