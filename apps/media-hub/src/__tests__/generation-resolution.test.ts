import { describe, expect, it } from "vitest";

import { createMediaGenerationSchema } from "@acme/validators";

import { resolutionOptions } from "../lib/generation-resolution";

describe("H3 generation resolutions", () => {
  it("defaults to the official 768-pixel short-edge baseline", () => {
    expect(resolutionOptions[0]).toMatchObject({
      value: "1344x768",
      width: 1344,
      height: 768,
    });
    expect(
      createMediaGenerationSchema.parse({ prompt: "A robot" }),
    ).toMatchObject({ width: 1344, height: 768, qualityPreset: "balanced" });
  });

  it("only exposes resolutions accepted by the H3 provider", () => {
    for (const option of resolutionOptions) {
      expect(option.width % 32, option.label).toBe(0);
      expect(option.height % 32, option.label).toBe(0);
      expect(
        createMediaGenerationSchema.safeParse({
          prompt: "A robot",
          width: option.width,
          height: option.height,
        }).success,
        option.label,
      ).toBe(true);
    }
  });

  it("rejects the previously exposed 720p dimensions", () => {
    expect(
      createMediaGenerationSchema.safeParse({
        prompt: "A robot",
        width: 1280,
        height: 720,
      }).success,
    ).toBe(false);
    expect(
      createMediaGenerationSchema.safeParse({
        prompt: "A robot",
        width: 720,
        height: 1280,
      }).success,
    ).toBe(false);
  });
});
