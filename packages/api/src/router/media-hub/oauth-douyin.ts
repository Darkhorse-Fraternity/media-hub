import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";

import { eq } from "@acme/db";
import { db } from "@acme/db/client";
import { mediaPlatformAccount } from "@acme/db/schema";
import { log } from "@acme/logger";
import {
  douyinOAuthCallbackSchema,
  startDouyinOAuthSchema,
} from "@acme/validators";

import { protectedProcedure, publicProcedure } from "../../trpc";
import { encryptToken } from "./crypto";
import { createOAuthState, verifyOAuthState } from "./oauth-state";

const DOUYIN_AUTH_URL = "https://open.douyin.com/platform/oauth/connect/";
const DOUYIN_TOKEN_URL = "https://open.douyin.com/oauth/access_token/";
const DOUYIN_USERINFO_URL = "https://open.douyin.com/oauth/userinfo/";
const DOUYIN_SCOPES = ["user_info", "video.create.bind"];

interface DouyinTokenResponse {
  data?: {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number | string;
    open_id?: string;
    scope?: string;
    error_code?: number;
    description?: string;
  };
  message?: string;
}

interface DouyinUserInfoResponse {
  data?: {
    open_id?: string;
    nickname?: string;
    error_code?: number | string;
    description?: string;
  };
  err_no?: number;
  err_msg?: string;
}

function getDouyinEnv() {
  const clientKey = process.env.DOUYIN_CLIENT_KEY;
  const clientSecret = process.env.DOUYIN_CLIENT_SECRET;
  const redirectUri = process.env.DOUYIN_OAUTH_REDIRECT_URI;
  if (!clientKey || !clientSecret || !redirectUri) {
    throw new Error(
      "Missing DOUYIN_CLIENT_KEY / DOUYIN_CLIENT_SECRET / DOUYIN_OAUTH_REDIRECT_URI",
    );
  }
  return { clientKey, clientSecret, redirectUri };
}

export function buildDouyinOAuthUrl(userId: string, returnTo: string): string {
  const { clientKey, redirectUri } = getDouyinEnv();
  const state = createOAuthState({
    userId,
    platform: "douyin",
    returnTo,
  });
  const url = new URL(DOUYIN_AUTH_URL);
  url.searchParams.set("client_key", clientKey);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", DOUYIN_SCOPES.join(","));
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

export async function completeDouyinOAuthCallback(input: {
  code: string;
  state: string;
}): Promise<{
  accountId: string;
  accountLabel: string;
  returnTo: string;
  refreshed: boolean;
}> {
  const stateInfo = verifyOAuthState(input.state);
  if (stateInfo.platform !== "douyin") {
    throw new Error("Platform mismatch in state");
  }
  const { clientKey, clientSecret } = getDouyinEnv();
  const tokenResponse = await fetch(DOUYIN_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      code: input.code,
      grant_type: "authorization_code",
    }),
  });
  const tokenBody = (await tokenResponse.json()) as DouyinTokenResponse;
  const token = tokenBody.data;
  if (
    !tokenResponse.ok ||
    !token?.access_token ||
    !token.refresh_token ||
    !token.open_id ||
    Number(token.error_code ?? 0) !== 0
  ) {
    log.error("Douyin OAuth token exchange failed", {
      code: "DOUYIN_OAUTH_TOKEN_FAILED",
      status: tokenResponse.status,
      platform_error_code: token?.error_code,
      platform_message: token?.description ?? tokenBody.message,
    });
    throw new Error(
      `抖音授权码换取令牌失败：${token?.description ?? tokenBody.message ?? `HTTP ${tokenResponse.status}`}`,
    );
  }

  const userResponse = await fetch(DOUYIN_USERINFO_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      access_token: token.access_token,
      open_id: token.open_id,
    }),
  });
  const userBody = (await userResponse.json()) as DouyinUserInfoResponse;
  if (
    !userResponse.ok ||
    Number(userBody.err_no ?? userBody.data?.error_code ?? 0) !== 0
  ) {
    throw new Error(
      `读取抖音账号信息失败：${userBody.err_msg ?? userBody.data?.description ?? `HTTP ${userResponse.status}`}`,
    );
  }
  const nickname = userBody.data?.nickname?.trim();
  const accountLabel = nickname?.length ? nickname : token.open_id;
  const externalAccountId = token.open_id;
  const existing = await db.query.mediaPlatformAccount.findFirst({
    where: (account, { and, eq: eqOp }) =>
      and(
        eqOp(account.platform, "douyin"),
        eqOp(account.externalAccountId, externalAccountId),
      ),
  });
  const now = new Date();
  const expiresIn = Number(token.expires_in ?? 0);
  const tokenExpiresAt = new Date(
    now.getTime() + Math.max(expiresIn, 60) * 1000,
  );
  const values = {
    accountLabel,
    accessTokenEnc: encryptToken(token.access_token),
    refreshTokenEnc: encryptToken(token.refresh_token),
    tokenExpiresAt,
    scopes: token.scope ?? DOUYIN_SCOPES.join(","),
    updatedAt: now,
  };

  if (existing) {
    if (existing.createdBy !== stateInfo.userId) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "该抖音账号已绑定到其他后台用户，请联系管理员转交归属",
      });
    }
    await db
      .update(mediaPlatformAccount)
      .set(values)
      .where(eq(mediaPlatformAccount.id, existing.id));
    return {
      accountId: existing.id,
      accountLabel,
      returnTo: stateInfo.returnTo,
      refreshed: true,
    };
  }

  const accountId = crypto.randomUUID();
  await db.insert(mediaPlatformAccount).values({
    id: accountId,
    platform: "douyin",
    externalAccountId,
    createdBy: stateInfo.userId,
    createdAt: now,
    ...values,
  });
  return {
    accountId,
    accountLabel,
    returnTo: stateInfo.returnTo,
    refreshed: false,
  };
}

export const mediaDouyinRouter = {
  oauthStart: protectedProcedure
    .input(startDouyinOAuthSchema)
    .mutation(({ ctx, input }) => ({
      url: buildDouyinOAuthUrl(ctx.session.user.id, input.returnTo),
    })),
  oauthCallback: publicProcedure
    .input(douyinOAuthCallbackSchema)
    .mutation(async ({ input }) => {
      try {
        return await completeDouyinOAuthCallback(input);
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }),
} satisfies TRPCRouterRecord;
