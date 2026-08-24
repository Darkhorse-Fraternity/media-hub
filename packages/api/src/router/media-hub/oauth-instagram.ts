// packages/api/src/router/media-hub/oauth-instagram.ts
import "./meta-proxy";

import type { TRPCRouterRecord } from "@trpc/server";
import { TRPCError } from "@trpc/server";

import { eq } from "@acme/db";
import { db } from "@acme/db/client";
import { mediaPlatformAccount } from "@acme/db/schema";
import { log } from "@acme/logger";

import { protectedProcedure, publicProcedure } from "../../trpc";
import { encryptToken } from "./crypto";
import { createOAuthState, verifyOAuthState } from "./oauth-state";

const META_VERSION = process.env.META_API_VERSION ?? "v21.0";
const META_AUTH_URL = `https://www.facebook.com/${META_VERSION}/dialog/oauth`;
const META_TOKEN_URL = `https://graph.facebook.com/${META_VERSION}/oauth/access_token`;
const META_GRAPH_URL = `https://graph.facebook.com/${META_VERSION}`;

const META_SCOPES = [
  "instagram_basic",
  "instagram_content_publish",
  "instagram_manage_insights",
  "pages_show_list",
  "pages_read_engagement",
];

interface MetaTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
}

interface MetaPage {
  id: string;
  name: string;
  tasks?: string[];
  instagram_business_account?: {
    id: string;
    name?: string;
    username?: string;
  };
}

interface MetaPagesResponse {
  data?: MetaPage[];
}

interface MetaPermission {
  permission: string;
  status: string;
}

interface MetaPermissionsResponse {
  data?: MetaPermission[];
}

interface MetaDebugTokenResponse {
  data?: {
    scopes?: string[];
    granular_scopes?: {
      scope?: string;
      target_ids?: string[];
    }[];
  };
}

interface MetaIgUserResponse {
  id: string;
  name?: string;
  username?: string;
}

function getEnv() {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const redirectUri = process.env.META_OAUTH_REDIRECT_URI;
  if (!appId || !appSecret || !redirectUri) {
    throw new Error(
      "Missing META_APP_ID / META_APP_SECRET / META_OAUTH_REDIRECT_URI",
    );
  }
  return { appId, appSecret, redirectUri };
}

async function fetchMeta(url: string, phase: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    return await fetch(url, { signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      log.error("Meta request timed out", {
        code: "META_REQUEST_TIMEOUT",
        phase,
      });
      throw new Error(`Meta request timed out during ${phase}`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function getConfiguredPageIds(): string[] {
  return [process.env.META_FACEBOOK_PAGE_ID, process.env.META_FACEBOOK_PAGE_IDS]
    .filter((value): value is string => !!value)
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
}

function getDebugTokenPageIds(debugJson: MetaDebugTokenResponse): string[] {
  const ids =
    debugJson.data?.granular_scopes
      ?.filter((scope) =>
        ["pages_show_list", "pages_read_engagement"].includes(
          scope.scope ?? "",
        ),
      )
      .flatMap((scope) => scope.target_ids ?? []) ?? [];

  return [...new Set(ids)];
}

function getDebugTokenInstagramUserIds(
  debugJson: MetaDebugTokenResponse,
): string[] {
  const ids =
    debugJson.data?.granular_scopes
      ?.filter((scope) =>
        [
          "instagram_basic",
          "instagram_content_publish",
          "instagram_manage_insights",
        ].includes(scope.scope ?? ""),
      )
      .flatMap((scope) => scope.target_ids ?? []) ?? [];

  return [...new Set(ids)];
}

async function fetchPageById(
  pageId: string,
  token: string,
): Promise<MetaPage | null> {
  const res = await fetchMeta(
    `${META_GRAPH_URL}/${pageId}?fields=id,name,instagram_business_account{id,name,username}&access_token=${token}`,
    "page_fetch_by_id",
  );
  if (!res.ok) {
    const body = await res.text();
    log.warn("Meta page fetch by id failed", {
      code: "META_PAGE_BY_ID_FAILED",
      page_id: pageId,
      status: res.status,
      body,
    });
    return null;
  }

  const page = (await res.json()) as MetaPage;
  log.info("Meta page fetched by id for Instagram OAuth", {
    code: "META_PAGE_BY_ID_FETCHED",
    page_id: page.id,
    name: page.name,
    has_instagram_business_account: !!page.instagram_business_account,
    ig_user_id: page.instagram_business_account?.id,
    ig_username: page.instagram_business_account?.username,
    tasks: page.tasks,
  });
  return page;
}

async function fetchInstagramUserById(
  igUserId: string,
  token: string,
): Promise<MetaIgUserResponse | null> {
  const res = await fetchMeta(
    `${META_GRAPH_URL}/${igUserId}?fields=id,name,username&access_token=${token}`,
    "ig_user_fetch_by_id",
  );
  if (!res.ok) {
    const body = await res.text();
    log.warn("Meta Instagram user fetch by id failed", {
      code: "META_IG_BY_ID_FAILED",
      ig_user_id: igUserId,
      status: res.status,
      body,
    });
    return null;
  }

  const igUser = (await res.json()) as MetaIgUserResponse;
  log.info("Meta Instagram user fetched by id for OAuth", {
    code: "META_IG_BY_ID_FETCHED",
    ig_user_id: igUser.id,
    username: igUser.username,
    name: igUser.name,
  });
  return igUser;
}

export function buildInstagramOAuthUrl(userId: string): string {
  const { appId, redirectUri } = getEnv();
  const loginConfigId = process.env.META_LOGIN_CONFIG_ID;
  const state = createOAuthState({
    userId,
    platform: "instagram",
    returnTo: "",
  });
  const url = new URL(META_AUTH_URL);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  url.searchParams.set("auth_type", "rerequest");
  url.searchParams.set("enable_profile_selector", "1");
  if (loginConfigId) {
    url.searchParams.set("config_id", loginConfigId);
    url.searchParams.set("override_default_response_type", "true");
  } else {
    url.searchParams.set("scope", META_SCOPES.join(","));
  }
  return url.toString();
}

export async function completeInstagramOAuthCallback(input: {
  code: string;
  state: string;
}): Promise<{ accountId: string; accountLabel: string; refreshed: boolean }> {
  const stateInfo = verifyOAuthState(input.state);
  if (stateInfo.platform !== "instagram") {
    throw new Error("Platform mismatch in state");
  }

  const { appId, appSecret, redirectUri } = getEnv();

  const shortRes = await fetchMeta(
    `${META_TOKEN_URL}?${new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      redirect_uri: redirectUri,
      code: input.code,
    }).toString()}`,
    "short_token_exchange",
  );
  if (!shortRes.ok) {
    const body = await shortRes.text();
    log.error("Meta short-lived token exchange failed", {
      code: "META_TOKEN_SHORT_FAILED",
      status: shortRes.status,
      body,
    });
    throw new Error("Failed to exchange OAuth code");
  }
  const shortJson = (await shortRes.json()) as MetaTokenResponse;

  const longRes = await fetchMeta(
    `${META_TOKEN_URL}?${new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: shortJson.access_token,
    }).toString()}`,
    "long_token_exchange",
  );
  if (!longRes.ok) {
    const body = await longRes.text();
    log.error("Meta long-lived token exchange failed", {
      code: "META_TOKEN_LONG_FAILED",
      status: longRes.status,
      body,
    });
    throw new Error("Failed to get long-lived token");
  }
  const longJson = (await longRes.json()) as MetaTokenResponse;
  const longToken = longJson.access_token;
  const expiresIn = longJson.expires_in ?? 60 * 24 * 3600;

  let debugTokenJson: MetaDebugTokenResponse | undefined;
  const debugTokenRes = await fetchMeta(
    `${META_GRAPH_URL}/debug_token?${new URLSearchParams({
      input_token: longToken,
      access_token: `${appId}|${appSecret}`,
    }).toString()}`,
    "debug_token_fetch",
  );
  if (debugTokenRes.ok) {
    debugTokenJson = (await debugTokenRes.json()) as MetaDebugTokenResponse;
    log.info("Meta debug token fetched for Instagram OAuth", {
      code: "META_DEBUG_TOKEN_FETCHED",
      scopes: debugTokenJson.data?.scopes,
      granular_scopes: debugTokenJson.data?.granular_scopes,
    });
  } else {
    const body = await debugTokenRes.text();
    log.warn("Meta debug token fetch failed", {
      code: "META_DEBUG_TOKEN_FAILED",
      status: debugTokenRes.status,
      body,
    });
  }

  const permissionsRes = await fetchMeta(
    `${META_GRAPH_URL}/me/permissions?access_token=${longToken}`,
    "permissions_fetch",
  );
  if (permissionsRes.ok) {
    const permissionsJson =
      (await permissionsRes.json()) as MetaPermissionsResponse;
    log.info("Meta permissions fetched for Instagram OAuth", {
      code: "META_PERMISSIONS_FETCHED",
      permissions: permissionsJson.data,
    });
  } else {
    const body = await permissionsRes.text();
    log.warn("Meta permissions fetch failed", {
      code: "META_PERMISSIONS_FAILED",
      status: permissionsRes.status,
      body,
    });
  }

  const pagesRes = await fetchMeta(
    `${META_GRAPH_URL}/me/accounts?fields=id,name,tasks,instagram_business_account{id,name,username}&access_token=${longToken}`,
    "pages_fetch",
  );
  if (!pagesRes.ok) {
    const body = await pagesRes.text();
    log.error("Meta pages fetch failed", {
      code: "META_PAGES_FAILED",
      status: pagesRes.status,
      body,
    });
    throw new Error("Failed to fetch Facebook Pages");
  }
  const pagesJson = (await pagesRes.json()) as MetaPagesResponse;
  log.info("Meta pages fetched for Instagram OAuth", {
    code: "META_PAGES_FETCHED",
    page_count: pagesJson.data?.length ?? 0,
    pages: (pagesJson.data ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      has_instagram_business_account: !!p.instagram_business_account,
      ig_user_id: p.instagram_business_account?.id,
      ig_username: p.instagram_business_account?.username,
      tasks: p.tasks,
    })),
  });
  const page = (pagesJson.data ?? []).find(
    (p) => !!p.instagram_business_account,
  );
  const fallbackPageIds = [
    ...(debugTokenJson ? getDebugTokenPageIds(debugTokenJson) : []),
    ...getConfiguredPageIds(),
  ];
  const fallbackPages =
    page?.instagram_business_account || fallbackPageIds.length === 0
      ? []
      : await Promise.all(
          fallbackPageIds.map((pageId) => fetchPageById(pageId, longToken)),
        );
  const resolvedPage =
    page ??
    fallbackPages.find((candidate) => !!candidate?.instagram_business_account);
  const directIgUserIds =
    !resolvedPage?.instagram_business_account && debugTokenJson
      ? getDebugTokenInstagramUserIds(debugTokenJson)
      : [];
  const directIgUsers =
    directIgUserIds.length === 0
      ? []
      : await Promise.all(
          directIgUserIds.map((igUserId) =>
            fetchInstagramUserById(igUserId, longToken),
          ),
        );
  const directIgUser = directIgUsers.find((candidate) => !!candidate);

  if (!resolvedPage?.instagram_business_account && !directIgUser) {
    throw new Error(
      "Meta did not return an Instagram Business/Creator account for the authorized Pages. In the Facebook authorization dialog, click Edit access and make sure the Pumpkii Page is selected.",
    );
  }
  const igUserId =
    resolvedPage?.instagram_business_account?.id ?? directIgUser?.id;
  if (!igUserId) {
    throw new Error("Unable to resolve Instagram Business/Creator account id.");
  }

  const igJson = directIgUser ??
    (await fetchInstagramUserById(igUserId, longToken)) ?? {
      id: igUserId,
      username: igUserId,
    };
  const accountLabel = igJson.username
    ? `@${igJson.username}`
    : resolvedPage?.instagram_business_account?.username
      ? `@${resolvedPage.instagram_business_account.username}`
      : (igJson.name ??
        resolvedPage?.instagram_business_account?.name ??
        igUserId);

  const existing = await db.query.mediaPlatformAccount.findFirst({
    where: (acc, { and, eq: eqOp }) =>
      and(
        eqOp(acc.platform, "instagram"),
        eqOp(acc.externalAccountId, igUserId),
      ),
  });

  const now = new Date();
  const tokenExpiresAt = new Date(now.getTime() + expiresIn * 1000);

  if (existing) {
    if (existing.createdBy !== stateInfo.userId) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "该 Instagram 账号已绑定到其他后台用户，请联系管理员转交归属",
      });
    }
    await db
      .update(mediaPlatformAccount)
      .set({
        accountLabel,
        accessTokenEnc: encryptToken(longToken),
        tokenExpiresAt,
        scopes: META_SCOPES.join(","),
        updatedAt: now,
      })
      .where(eq(mediaPlatformAccount.id, existing.id));
    log.info("Instagram account re-authorized", {
      code: "IG_OAUTH_REFRESHED",
      account_id: existing.id,
      ig_user_id: igUserId,
      label: accountLabel,
    });
    return { accountId: existing.id, accountLabel, refreshed: true };
  }

  const id = crypto.randomUUID();
  await db.insert(mediaPlatformAccount).values({
    id,
    platform: "instagram",
    accountLabel,
    externalAccountId: igUserId,
    accessTokenEnc: encryptToken(longToken),
    refreshTokenEnc: null,
    tokenExpiresAt,
    scopes: META_SCOPES.join(","),
    createdBy: stateInfo.userId,
    createdAt: now,
    updatedAt: now,
  });

  log.info("Instagram account authorized", {
    code: "IG_OAUTH_DONE",
    account_id: id,
    ig_user_id: igUserId,
    label: accountLabel,
  });

  return { accountId: id, accountLabel, refreshed: false };
}

export const mediaInstagramRouter = {
  oauthStart: protectedProcedure.mutation(({ ctx }) => {
    return { url: buildInstagramOAuthUrl(ctx.session.user.id) };
  }),

  oauthCallback: publicProcedure
    .input((raw: unknown) => {
      const obj = raw as Record<string, unknown>;
      if (typeof obj.code !== "string" || typeof obj.state !== "string") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Missing code or state",
        });
      }
      return { code: obj.code, state: obj.state };
    })
    .mutation(async ({ input }) => {
      try {
        return await completeInstagramOAuthCallback(input);
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        throw new TRPCError({
          code:
            err instanceof Error &&
            (err.message.includes("Platform mismatch") ||
              err.message.includes("Meta did not return an Instagram"))
              ? "BAD_REQUEST"
              : "INTERNAL_SERVER_ERROR",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }),
} satisfies TRPCRouterRecord;
