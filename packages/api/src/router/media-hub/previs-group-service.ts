import type { z } from "zod/v4";
import { TRPCError } from "@trpc/server";

import type { db as applicationDb } from "@acme/db/client";
import type {
  createMediaPrevisGroupSchema,
  deleteMediaPrevisGroupSchema,
  updateMediaPrevisGroupSchema,
} from "@acme/validators";
import { and, asc, count, eq, sql } from "@acme/db";
import { mediaPrevisGroup, mediaPrevisScene } from "@acme/db/schema";

type Database = typeof applicationDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export async function requirePrevisGroup(
  database: Pick<Database, "select">,
  owner: string,
  id: string,
  lock: "update" | "key share" = "key share",
) {
  const [group] = await database
    .select()
    .from(mediaPrevisGroup)
    .where(
      and(eq(mediaPrevisGroup.id, id), eq(mediaPrevisGroup.ownerUserId, owner)),
    )
    .for(lock)
    .limit(1);
  if (!group)
    throw new TRPCError({ code: "NOT_FOUND", message: "白模分组不存在" });
  return group;
}

export async function listPrevisGroups(database: Database, owner: string) {
  const items = await database
    .select({
      id: mediaPrevisGroup.id,
      name: mediaPrevisGroup.name,
      version: mediaPrevisGroup.version,
      createdAt: mediaPrevisGroup.createdAt,
      updatedAt: mediaPrevisGroup.updatedAt,
      sceneCount: count(mediaPrevisScene.id),
    })
    .from(mediaPrevisGroup)
    .leftJoin(
      mediaPrevisScene,
      and(
        eq(mediaPrevisScene.groupId, mediaPrevisGroup.id),
        eq(mediaPrevisScene.ownerUserId, owner),
      ),
    )
    .where(eq(mediaPrevisGroup.ownerUserId, owner))
    .groupBy(mediaPrevisGroup.id)
    .orderBy(asc(mediaPrevisGroup.name), asc(mediaPrevisGroup.id));
  return { items };
}

export async function createPrevisGroup(
  database: Database,
  owner: string,
  input: z.infer<typeof createMediaPrevisGroupSchema>,
) {
  const [group] = await database
    .insert(mediaPrevisGroup)
    .values({ id: crypto.randomUUID(), ownerUserId: owner, name: input.name })
    .onConflictDoNothing({
      target: [mediaPrevisGroup.ownerUserId, mediaPrevisGroup.name],
    })
    .returning();
  if (!group)
    throw new TRPCError({ code: "CONFLICT", message: "已有同名白模分组" });
  return { group };
}

function stale() {
  return new TRPCError({
    code: "CONFLICT",
    message: "分组已更新，请刷新后重试",
  });
}

export async function updatePrevisGroup(
  database: Database,
  owner: string,
  input: z.infer<typeof updateMediaPrevisGroupSchema>,
) {
  try {
    return await database.transaction(async (tx: Transaction) => {
      const group = await requirePrevisGroup(tx, owner, input.id, "update");
      if (group.version !== input.version) throw stale();
      const [updated] = await tx
        .update(mediaPrevisGroup)
        .set({
          name: input.name,
          version: group.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(mediaPrevisGroup.id, group.id))
        .returning();
      if (!updated) throw stale();
      return { group: updated };
    });
  } catch (error) {
    const cause = error instanceof Error ? error.cause : undefined;
    const code = (value: unknown) =>
      value && typeof value === "object" && "code" in value
        ? value.code
        : undefined;
    if (code(error) === "23505" || code(cause) === "23505")
      throw new TRPCError({ code: "CONFLICT", message: "已有同名白模分组" });
    throw error;
  }
}

export async function deletePrevisGroup(
  database: Database,
  owner: string,
  input: z.infer<typeof deleteMediaPrevisGroupSchema>,
) {
  return database.transaction(async (tx) => {
    const group = await requirePrevisGroup(tx, owner, input.id, "update");
    if (group.version !== input.version) throw stale();
    await tx
      .update(mediaPrevisScene)
      .set({
        groupId: null,
        version: sql`${mediaPrevisScene.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(mediaPrevisScene.ownerUserId, owner),
          eq(mediaPrevisScene.groupId, group.id),
        ),
      );
    await tx.delete(mediaPrevisGroup).where(eq(mediaPrevisGroup.id, group.id));
    return { deleted: true };
  });
}
