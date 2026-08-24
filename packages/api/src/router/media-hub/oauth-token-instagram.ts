// packages/api/src/router/media-hub/oauth-token-instagram.ts
import "./meta-proxy";

import { eq } from "@acme/db";
import { db } from "@acme/db/client";
import { mediaPlatformAccount } from "@acme/db/schema";
import { log } from "@acme/logger";

import { decryptToken, encryptToken } from "./crypto";

const META_VERSION = process.env.META_API_VERSION ?? "v21.0";
const REFRESH_LEEWAY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface RefreshResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export async function getValidInstagramAccessToken(
  accountId: string,
): Promise<{ token: string; igUserId: string }> {
  const account = await db.query.mediaPlatformAccount.findFirst({
    where: eq(mediaPlatformAccount.id, accountId),
  });
  if (!account) throw new Error(`Platform account not found: ${accountId}`);
  if (account.platform !== "instagram") {
    throw new Error(
      `Account ${accountId} is not an instagram account (got ${account.platform})`,
    );
  }

  const now = Date.now();
  const expiresAt = account.tokenExpiresAt?.getTime() ?? 0;
  const stillFresh = expiresAt - now > REFRESH_LEEWAY_MS;

  if (stillFresh) {
    return {
      token: decryptToken(account.accessTokenEnc),
      igUserId: account.externalAccountId,
    };
  }

  const currentToken = decryptToken(account.accessTokenEnc);
  const res = await fetch(
    `https://graph.facebook.com/${META_VERSION}/oauth/access_token?` +
      new URLSearchParams({
        grant_type: "ig_refresh_token",
        access_token: currentToken,
      }).toString(),
  );
  if (!res.ok) {
    const body = await res.text();
    log.error("Instagram token refresh failed", {
      code: "IG_TOKEN_REFRESH_FAILED",
      account_id: accountId,
      status: res.status,
      body,
    });
    throw new Error(`Instagram token refresh failed (HTTP ${res.status})`);
  }
  const json = (await res.json()) as RefreshResponse;
  const newExpiresAt = new Date(now + json.expires_in * 1000);

  await db
    .update(mediaPlatformAccount)
    .set({
      accessTokenEnc: encryptToken(json.access_token),
      tokenExpiresAt: newExpiresAt,
      updatedAt: new Date(now),
    })
    .where(eq(mediaPlatformAccount.id, accountId));

  log.info("Instagram token refreshed", {
    code: "IG_TOKEN_REFRESHED",
    account_id: accountId,
    expires_at: newExpiresAt.toISOString(),
  });

  return { token: json.access_token, igUserId: account.externalAccountId };
}
