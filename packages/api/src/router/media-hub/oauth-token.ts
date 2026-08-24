import { eq } from "@acme/db";
import { db } from "@acme/db/client";
import { mediaPlatformAccount } from "@acme/db/schema";
import { log } from "@acme/logger";

import { decryptToken, encryptToken } from "./crypto";

const YT_TOKEN_URL = "https://oauth2.googleapis.com/token";
/** access_token 还有不到 5 分钟过期就提前刷 */
const REFRESH_LEEWAY_MS = 5 * 60 * 1000;

interface RefreshResponse {
  access_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

/**
 * 拿到一个有效的 YouTube access_token。
 * 自动检查过期、刷新、写回 db。
 *
 * 调用方拿到 token 后立刻用，不要久存。
 */
export async function getValidYouTubeAccessToken(
  accountId: string,
): Promise<string> {
  const account = await db.query.mediaPlatformAccount.findFirst({
    where: eq(mediaPlatformAccount.id, accountId),
  });
  if (!account) {
    throw new Error(`Platform account not found: ${accountId}`);
  }
  if (account.platform !== "youtube") {
    throw new Error(
      `Account ${accountId} is not a youtube account (got ${account.platform})`,
    );
  }
  if (!account.refreshTokenEnc) {
    throw new Error(
      `Account ${accountId} has no refresh_token; reauthorize required`,
    );
  }

  const now = Date.now();
  const expiresAt = account.tokenExpiresAt?.getTime() ?? 0;
  const stillFresh = expiresAt - now > REFRESH_LEEWAY_MS;

  if (stillFresh) {
    return decryptToken(account.accessTokenEnc);
  }

  // === refresh ===
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Missing YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET");
  }

  const refreshToken = decryptToken(account.refreshTokenEnc);
  const res = await fetch(YT_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!res.ok) {
    const errBody = await res.text();
    log.error("YouTube token refresh failed", {
      code: "YT_TOKEN_REFRESH_FAILED",
      account_id: accountId,
      status: res.status,
      body: errBody,
    });
    throw new Error(`YouTube token refresh failed (HTTP ${res.status})`);
  }
  const json = (await res.json()) as RefreshResponse;

  const newExpiresAt = new Date(now + json.expires_in * 1000);
  await db
    .update(mediaPlatformAccount)
    .set({
      accessTokenEnc: encryptToken(json.access_token),
      tokenExpiresAt: newExpiresAt,
      scopes: json.scope,
      updatedAt: new Date(now),
    })
    .where(eq(mediaPlatformAccount.id, accountId));

  return json.access_token;
}
