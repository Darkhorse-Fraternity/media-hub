import { eq } from "@acme/db";
import { db } from "@acme/db/client";
import { mediaPlatformAccount } from "@acme/db/schema";
import { log } from "@acme/logger";

import { decryptToken, encryptToken } from "./crypto";

const DOUYIN_REFRESH_URL = "https://open.douyin.com/oauth/refresh_token/";
const REFRESH_LEEWAY_MS = 24 * 60 * 60 * 1000;

interface DouyinRefreshResponse {
  data?: {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number | string;
    scope?: string;
    error_code?: number;
    description?: string;
  };
  message?: string;
}

export async function getValidDouyinAccessToken(
  accountId: string,
): Promise<{ token: string; openId: string }> {
  const account = await db.query.mediaPlatformAccount.findFirst({
    where: eq(mediaPlatformAccount.id, accountId),
  });
  if (!account) throw new Error(`Platform account not found: ${accountId}`);
  if (account.platform !== "douyin") {
    throw new Error(
      `Account ${accountId} is not a douyin account (got ${account.platform})`,
    );
  }

  const now = Date.now();
  if ((account.tokenExpiresAt?.getTime() ?? 0) - now > REFRESH_LEEWAY_MS) {
    return {
      token: decryptToken(account.accessTokenEnc),
      openId: account.externalAccountId,
    };
  }
  if (!account.refreshTokenEnc) {
    throw new Error("抖音授权缺少 refresh_token，请重新绑定账号");
  }

  const clientKey = process.env.DOUYIN_CLIENT_KEY;
  if (!clientKey) throw new Error("Missing DOUYIN_CLIENT_KEY");
  const refreshToken = decryptToken(account.refreshTokenEnc);
  const response = await fetch(DOUYIN_REFRESH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: clientKey,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  const body = (await response.json()) as DouyinRefreshResponse;
  const data = body.data;
  if (
    !response.ok ||
    !data?.access_token ||
    Number(data.error_code ?? 0) !== 0
  ) {
    log.error("Douyin access token refresh failed", {
      code: "DOUYIN_TOKEN_REFRESH_FAILED",
      account_id: accountId,
      status: response.status,
      platform_error_code: data?.error_code,
      platform_message: data?.description ?? body.message,
    });
    throw new Error(
      `抖音授权刷新失败：${data?.description ?? body.message ?? `HTTP ${response.status}`}`,
    );
  }

  const expiresIn = Number(data.expires_in ?? 0);
  const nextRefreshToken = data.refresh_token ?? refreshToken;
  const tokenExpiresAt = new Date(now + Math.max(expiresIn, 60) * 1000);
  await db
    .update(mediaPlatformAccount)
    .set({
      accessTokenEnc: encryptToken(data.access_token),
      refreshTokenEnc: encryptToken(nextRefreshToken),
      tokenExpiresAt,
      scopes: data.scope ?? account.scopes,
      updatedAt: new Date(now),
    })
    .where(eq(mediaPlatformAccount.id, account.id));

  return { token: data.access_token, openId: account.externalAccountId };
}
