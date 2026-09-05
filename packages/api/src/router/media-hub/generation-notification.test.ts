import { describe, expect, it } from "vitest";

import { generationNotificationRetryDelayMs } from "./generation-notification-core";

describe("generation notification retry policy", () => {
  it("backs off quickly and caps retries at five minutes", () => {
    expect(generationNotificationRetryDelayMs(1)).toBe(5_000);
    expect(generationNotificationRetryDelayMs(2)).toBe(10_000);
    expect(generationNotificationRetryDelayMs(3)).toBe(20_000);
    expect(generationNotificationRetryDelayMs(20)).toBe(300_000);
  });
});
