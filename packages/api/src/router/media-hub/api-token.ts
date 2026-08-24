import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";

import { eq } from "@acme/db";
import { db } from "@acme/db/client";
import { mediaApiToken, user as User } from "@acme/db/schema";
import { log } from "@acme/logger";

import { protectedProcedure } from "../../trpc";
import {
  createMediaHubAgentToken,
  hashMediaHubAgentToken,
  parseMediaHubAgentToken,
} from "./api-token-crypto";
import { canUseMediaHubAgentToken } from "./api-token-policy";
import { decryptToken, encryptToken } from "./crypto";

function agentTokenIdForUser(userId: string): string {
  return `media-hub-agent:${userId}`;
}

export type MediaHubAgentActor = typeof User.$inferSelect;

export async function authenticateMediaHubAgentToken(
  authorization: string | null,
): Promise<MediaHubAgentActor | null> {
  const token = parseMediaHubAgentToken(authorization);
  if (!token) return null;

  const record = await db.query.mediaApiToken.findFirst({
    where: eq(mediaApiToken.tokenHash, hashMediaHubAgentToken(token)),
  });
  if (!record) return null;

  const actor = await db.query.user.findFirst({
    where: eq(User.id, record.createdBy),
  });
  if (!actor || !canUseMediaHubAgentToken(actor)) return null;

  void db
    .update(mediaApiToken)
    .set({ lastUsedAt: new Date() })
    .where(eq(mediaApiToken.id, record.id))
    .catch((error: unknown) => {
      log.warn("Media Hub Agent API last-used update failed", {
        code: "MEDIA_HUB_AGENT_TOKEN_TOUCH_FAILED",
        err: error instanceof Error ? error : new Error(String(error)),
      });
    });

  return actor;
}

export const mediaApiTokenRouter = {
  get: protectedProcedure.query(async ({ ctx }) => {
    const record = await ctx.db.query.mediaApiToken.findFirst({
      where: eq(mediaApiToken.createdBy, ctx.session.user.id),
    });
    if (!record) return null;

    try {
      return {
        token: decryptToken(record.tokenEnc),
        label: record.label,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        lastUsedAt: record.lastUsedAt,
      };
    } catch (error) {
      log.error("Media Hub Agent API token decryption failed", {
        code: "MEDIA_HUB_AGENT_TOKEN_DECRYPT_FAILED",
        err: error instanceof Error ? error : new Error(String(error)),
      });
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "API Token 解密失败，请重置 Token",
      });
    }
  }),

  reset: protectedProcedure.mutation(async ({ ctx }) => {
    const token = createMediaHubAgentToken();
    const tokenHash = hashMediaHubAgentToken(token);
    const tokenEnc = encryptToken(token);
    const now = new Date();
    const existing = await ctx.db.query.mediaApiToken.findFirst({
      where: eq(mediaApiToken.createdBy, ctx.session.user.id),
    });
    const tokenId = existing?.id ?? agentTokenIdForUser(ctx.session.user.id);
    await ctx.db
      .insert(mediaApiToken)
      .values({
        id: tokenId,
        label: `Media Hub Agent API · ${ctx.session.user.email}`,
        tokenHash,
        tokenEnc,
        createdBy: ctx.session.user.id,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: mediaApiToken.id,
        set: {
          label: `Media Hub Agent API · ${ctx.session.user.email}`,
          tokenHash,
          tokenEnc,
          createdBy: ctx.session.user.id,
          lastUsedAt: null,
          updatedAt: now,
        },
      });
    log.warn("Media Hub Agent API token reset", {
      code: "MEDIA_HUB_AGENT_TOKEN_RESET",
      actor_user_id: ctx.session.user.id,
    });
    return { token, updatedAt: now };
  }),
} satisfies TRPCRouterRecord;
