import { describe, expect, it } from "vitest";

import { formatGenerationElapsed } from "../lib/generation-display";

describe("formatGenerationElapsed", () => {
  it("returns null before generation starts", () => {
    expect(formatGenerationElapsed(null, null)).toBeNull();
  });

  it("formats a completed generation duration", () => {
    expect(
      formatGenerationElapsed(
        "2026-08-11T10:00:00.000Z",
        "2026-08-11T10:02:05.000Z",
      ),
    ).toBe("2 分 05 秒");
  });

  it("uses the current time while a generation is running", () => {
    expect(
      formatGenerationElapsed(
        "2026-08-11T10:00:00.000Z",
        null,
        new Date("2026-08-11T11:03:09.000Z").getTime(),
      ),
    ).toBe("1 小时 03 分 09 秒");
  });
});
