import { describe, expect, it } from "vitest";

import {
  createMediaHubAgentToken,
  hashMediaHubAgentToken,
  parseMediaHubAgentToken,
} from "./api-token-crypto";

describe("Media Hub Agent API token", () => {
  it("creates high-entropy prefixed tokens", () => {
    const first = createMediaHubAgentToken();
    const second = createMediaHubAgentToken();

    expect(first).toMatch(/^mh_agent_[A-Za-z0-9_-]{43}$/);
    expect(second).not.toBe(first);
  });

  it("hashes tokens deterministically without storing the plaintext", () => {
    const token = "mh_agent_example";
    const hash = hashMediaHubAgentToken(token);

    expect(hash).toHaveLength(64);
    expect(hash).toBe(hashMediaHubAgentToken(token));
    expect(hash).not.toContain(token);
  });

  it("accepts only prefixed Bearer tokens", () => {
    expect(parseMediaHubAgentToken("Bearer mh_agent_example")).toBe(
      "mh_agent_example",
    );
    expect(parseMediaHubAgentToken("Basic mh_agent_example")).toBeNull();
    expect(parseMediaHubAgentToken("Bearer example")).toBeNull();
  });
});
