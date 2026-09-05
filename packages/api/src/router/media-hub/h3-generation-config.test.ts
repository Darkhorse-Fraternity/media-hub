import { describe, expect, it } from "vitest";

import {
  H3_I2VA_ALIGNMENT,
  h3QualityPresets,
  h3SegmentCount,
  h3SegmentPrompts,
  h3StepsForPreset,
  validateH3GenerationPrompt,
} from "./h3-generation-config";

describe("H3 generation configuration", () => {
  it("maps the user-facing quality presets to the deployed Turbo schedule", () => {
    expect(H3_I2VA_ALIGNMENT).toContain("0.00 seconds");
    expect(h3QualityPresets.fast.steps).toBe(4);
    expect(h3QualityPresets.balanced.steps).toBe(6);
    expect(h3QualityPresets.quality.steps).toBe(8);
    expect(h3StepsForPreset("unknown")).toBe(6);
  });

  it("splits supported durations at the H3 segment limit", () => {
    expect(h3SegmentCount(15)).toBe(1);
    expect(h3SegmentCount(30)).toBe(2);
    expect(h3SegmentCount(60)).toBe(4);
  });

  it("uses exact marked prompts when the optimizer returned every segment", () => {
    expect(
      h3SegmentPrompts(
        "=== SEGMENT 1/2 ===\nfirst prompt\n=== SEGMENT 2/2 ===\nsecond prompt",
        2,
      ),
    ).toEqual(["first prompt", "second prompt"]);
  });

  it("adds explicit continuity when a long manual prompt has no markers", () => {
    const prompts = h3SegmentPrompts("A robot follows a dog.", 2);
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain("Establish the subject");
    expect(prompts[1]).toContain("exact ending frame");
    expect(prompts[1]).toContain("A robot follows a dog.");
  });

  it("rejects long prompts without complete optimized segments", () => {
    expect(validateH3GenerationPrompt("A robot follows a dog.", 30)).toEqual([
      expect.stringContaining("2 个完整分段"),
    ]);
  });

  it("rejects ambiguous generated speech and accepts exact H3 dialogue", () => {
    expect(
      validateH3GenerationPrompt(
        "integrated_multimodal_description: [Shot 1] A child murmurs indistinct reading sounds.\noverall_soundscape: Quiet room.\nnon_diegetic_music: N/A",
        15,
      ),
    ).toEqual([expect.stringContaining("含混人声")]);

    expect(
      validateH3GenerationPrompt(
        "integrated_multimodal_description: [Shot 1] The child (S2) <d>[Mandarin Chinese] 妈妈，我不会。</d>\noverall_soundscape: Quiet room.\nnon_diegetic_music: N/A",
        15,
      ),
    ).toEqual([]);
  });

  it("requires the three H3 fields in their official order", () => {
    expect(
      validateH3GenerationPrompt(
        "overall_soundscape: Quiet room.\nintegrated_multimodal_description: [Shot 1] A child reads silently.\nnon_diegetic_music: N/A",
        15,
      ),
    ).toEqual([expect.stringContaining("顺序不正确")]);
  });
});
