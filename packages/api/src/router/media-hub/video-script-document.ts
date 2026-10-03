import { TRPCError } from "@trpc/server";

import type { db as mediaHubDb } from "@acme/db/client";
import type { MediaVideoScriptShot } from "@acme/validators";
import { and, eq, isNull } from "@acme/db";
import { mediaVideoScript } from "@acme/db/schema";
import {
  analyzeMediaVideoScriptShots,
  mediaVideoScriptShotSchema,
} from "@acme/validators";

export type MediaHubDb = typeof mediaHubDb;

export async function requireOwnedScript(
  database: MediaHubDb,
  userId: string,
  id: string,
) {
  const script = await database.query.mediaVideoScript.findFirst({
    where: and(
      eq(mediaVideoScript.id, id),
      eq(mediaVideoScript.createdBy, userId),
      isNull(mediaVideoScript.deletedAt),
    ),
  });
  if (!script) {
    throw new TRPCError({ code: "NOT_FOUND", message: "视频脚本不存在" });
  }
  return script;
}

export async function updateOwnedShotDocument(
  database: MediaHubDb,
  userId: string,
  input: { id: string; shotId: string; version: number },
  change: (shot: MediaVideoScriptShot) => MediaVideoScriptShot,
) {
  const script = await requireOwnedScript(database, userId, input.id);
  if (script.version !== input.version) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "脚本已更新，请刷新后重试",
    });
  }
  if (!script.shots.some((shot) => shot.id === input.shotId)) {
    throw new TRPCError({ code: "NOT_FOUND", message: "脚本镜头不存在" });
  }
  const shots = script.shots.map((shot) => {
    if (shot.id !== input.shotId) return shot;
    const result = mediaVideoScriptShotSchema.safeParse(change(shot));
    if (!result.success) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: result.error.issues[0]?.message ?? "镜头配置无效",
      });
    }
    return result.data;
  });
  const [updated] = await database
    .update(mediaVideoScript)
    .set({ shots, version: script.version + 1, updatedAt: new Date() })
    .where(
      and(
        eq(mediaVideoScript.id, script.id),
        eq(mediaVideoScript.createdBy, userId),
        eq(mediaVideoScript.version, script.version),
        isNull(mediaVideoScript.deletedAt),
      ),
    )
    .returning();
  if (!updated) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "脚本已更新，请刷新后重试",
    });
  }
  return scriptSummary(updated);
}

export function scriptSummary<T extends { shots: MediaVideoScriptShot[] }>(
  script: T,
) {
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
