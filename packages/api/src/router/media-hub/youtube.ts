import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";

import { eq } from "@acme/db";
import { mediaPlatformAccount } from "@acme/db/schema";
import { log } from "@acme/logger";
import {
  startYouTubeOAuthSchema,
  youTubeOAuthCallbackSchema,
} from "@acme/validators";

import { protectedProcedure, publicProcedure } from "../../trpc";
import { encryptToken } from "./crypto";
import { createOAuthState, verifyOAuthState } from "./oauth-state";

const YT_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const YT_TOKEN_URL = "https://oauth2.googleapis.com/token";
const YT_CHANNELS_URL = "https://www.googleapis.com/youtube/v3/channels";

const YT_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/youtube.force-ssl",
];

interface YouTubeTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

interface YouTubeChannelsResponse {
  items?: {
    id: string;
    snippet: { title: string };
  }[];
}

function getEnv(): {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
} {
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  const redirectUri = process.env.YOUTUBE_OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "Missing YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET / YOUTUBE_OAUTH_REDIRECT_URI",
    );
  }
  return { clientId, clientSecret, redirectUri };
}

export const mediaYouTubeRouter = {
  /** 生成 OAuth 跳转 URL，前端 window.location 过去 */
  oauthStart: protectedProcedure
    .input(startYouTubeOAuthSchema)
    .mutation(({ ctx, input }) => {
      const { clientId, redirectUri } = getEnv();
      const state = createOAuthState({
        userId: ctx.session.user.id,
        platform: "youtube",
        returnTo: input.returnTo,
      });
      const url = new URL(YT_AUTH_URL);
      url.searchParams.set("client_id", clientId);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", YT_SCOPES.join(" "));
      url.searchParams.set("access_type", "offline");
      url.searchParams.set("prompt", "consent");
      url.searchParams.set("include_granted_scopes", "true");
      url.searchParams.set("state", state);
      return { url: url.toString() };
    }),

  /** Google 跳回前端后，前端把 code+state 转给 server 完成换 token */
  oauthCallback: publicProcedure
    .input(youTubeOAuthCallbackSchema)
    .mutation(async ({ ctx, input }) => {
      // 1) 验 state（state 已签名，包含 userId，无需登录态）
      const stateInfo = verifyOAuthState(input.state);
      if (stateInfo.platform !== "youtube") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Platform mismatch in state",
        });
      }

      const { clientId, clientSecret, redirectUri } = getEnv();

      // 2) code → token
      const tokenRes = await fetch(YT_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code: input.code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
      });
      if (!tokenRes.ok) {
        const errBody = await tokenRes.text();
        log.error("YouTube token exchange failed", {
          code: "YT_OAUTH_TOKEN_FAILED",
          status: tokenRes.status,
          body: errBody,
        });
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to exchange OAuth code for token",
        });
      }
      const tokenJson = (await tokenRes.json()) as YouTubeTokenResponse;
      if (!tokenJson.refresh_token) {
        // 没拿到 refresh_token 一般是 prompt!=consent 或同 client 之前已授权过
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            "YouTube did not return a refresh_token. Revoke prior grants and retry.",
        });
      }

      // 3) 拉 channel info（拿 channelId + label）
      const chRes = await fetch(`${YT_CHANNELS_URL}?part=snippet&mine=true`, {
        headers: { Authorization: `Bearer ${tokenJson.access_token}` },
      });
      if (!chRes.ok) {
        const errBody = await chRes.text();
        log.error("YouTube channels.list failed", {
          code: "YT_CHANNEL_FETCH_FAILED",
          status: chRes.status,
          body: errBody,
        });
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch YouTube channel info",
        });
      }
      const chJson = (await chRes.json()) as YouTubeChannelsResponse;
      const channel = chJson.items?.[0];
      if (!channel) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Authorized Google account has no YouTube channel. Create one and retry.",
        });
      }

      const externalAccountId = channel.id;
      const accountLabel = channel.snippet.title;

      // 4) upsert 平台账号（同 channel 重新授权时刷新 token）
      const existing = await ctx.db.query.mediaPlatformAccount.findFirst({
        where: (acc, { and, eq: eqOp }) =>
          and(
            eqOp(acc.platform, "youtube"),
            eqOp(acc.externalAccountId, externalAccountId),
          ),
      });

      const now = new Date();
      const expiresAt = new Date(now.getTime() + tokenJson.expires_in * 1000);

      if (existing) {
        if (existing.createdBy !== stateInfo.userId) {
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "该 YouTube 频道已绑定到其他后台用户，请联系管理员转交归属",
          });
        }
        await ctx.db
          .update(mediaPlatformAccount)
          .set({
            accountLabel,
            accessTokenEnc: encryptToken(tokenJson.access_token),
            refreshTokenEnc: encryptToken(tokenJson.refresh_token),
            tokenExpiresAt: expiresAt,
            scopes: tokenJson.scope,
            updatedAt: now,
          })
          .where(eq(mediaPlatformAccount.id, existing.id));
        return {
          accountId: existing.id,
          accountLabel,
          returnTo: stateInfo.returnTo,
          refreshed: true,
        };
      }

      const id = crypto.randomUUID();
      await ctx.db.insert(mediaPlatformAccount).values({
        id,
        platform: "youtube",
        accountLabel,
        externalAccountId,
        accessTokenEnc: encryptToken(tokenJson.access_token),
        refreshTokenEnc: encryptToken(tokenJson.refresh_token),
        tokenExpiresAt: expiresAt,
        scopes: tokenJson.scope,
        createdBy: stateInfo.userId,
        createdAt: now,
        updatedAt: now,
      });

      return {
        accountId: id,
        accountLabel,
        returnTo: stateInfo.returnTo,
        refreshed: false,
      };
    }),
} satisfies TRPCRouterRecord;
