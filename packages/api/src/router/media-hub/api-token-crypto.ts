import { createHash, randomBytes } from "node:crypto";

const tokenPrefix = "mh_agent_";

export function createMediaHubAgentToken(): string {
  return `${tokenPrefix}${randomBytes(32).toString("base64url")}`;
}

export function hashMediaHubAgentToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function parseMediaHubAgentToken(
  authorization: string | null,
): string | null {
  const match = /^Bearer\s+(.+)$/i.exec(authorization ?? "");
  const token = match?.[1]?.trim();
  return token?.startsWith(tokenPrefix) ? token : null;
}
