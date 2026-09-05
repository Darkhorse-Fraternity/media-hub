import { describe, expect, it } from "vitest";

import { draftScriptBody, patchScriptBody } from "../lib/agent-video-script";

describe("agent video script PATCH schema", () => {
  it("does not inject create defaults into an omitted PATCH field", () => {
    expect(
      patchScriptBody.parse({ version: 3, copy_status: "approved" }),
    ).toEqual({ version: 3, copy_status: "approved" });
  });
});

describe("agent video script draft duration", () => {
  it("accepts only the four H3 script duration presets", () => {
    for (const duration of [15, 30, 45, 60]) {
      expect(
        draftScriptBody.safeParse({
          brief: "A short story",
          target_duration_seconds: duration,
        }).success,
      ).toBe(true);
    }
    expect(
      draftScriptBody.safeParse({
        brief: "A short story",
        target_duration_seconds: 20,
      }).success,
    ).toBe(false);
  });
});
