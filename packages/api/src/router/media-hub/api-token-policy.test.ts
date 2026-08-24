import { describe, expect, it } from "vitest";

import { canUseMediaHubAgentToken } from "./api-token-policy";

describe("Media Hub Agent API token policy", () => {
  it("allows active members and admins", () => {
    expect(canUseMediaHubAgentToken({ role: "member", banned: false })).toBe(
      true,
    );
    expect(canUseMediaHubAgentToken({ role: "admin", banned: false })).toBe(
      true,
    );
  });

  it("rejects banned or unsupported actors", () => {
    expect(canUseMediaHubAgentToken({ role: "member", banned: true })).toBe(
      false,
    );
    expect(canUseMediaHubAgentToken({ role: "guest", banned: false })).toBe(
      false,
    );
    expect(canUseMediaHubAgentToken(null)).toBe(false);
  });
});
