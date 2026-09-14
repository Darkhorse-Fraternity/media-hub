import { describe, expect, it } from "vitest";

import {
  compileH3StructuredDialoguePrompt,
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

  it("compiles authoritative dialogue with normalized speaker order and language", () => {
    const compiled = compileH3StructuredDialoguePrompt(
      "A mother and her son talk in a quiet kitchen.",
      15,
      [
        {
          segment: 1,
          speakerId: "S2",
          language: "zh",
          text: "先洗手。",
          voice: "warm adult female voice, calm pace",
          delivery: "on_screen",
        },
        {
          segment: 1,
          speakerId: "S1",
          language: "zh",
          text: "好，我马上来。",
          delivery: "off_screen_voiceover",
        },
      ],
    );

    expect(compiled.dialogues.map((dialogue) => dialogue.speakerId)).toEqual([
      "S1",
      "S2",
    ]);
    expect(compiled.prompt).toContain(
      "(S1) <d>[Mandarin Chinese] 先洗手。</d>",
    );
    expect(compiled.prompt).toContain(
      "every visible person keeps their mouth closed: (S2) <d>[Mandarin Chinese] 好，我马上来。</d>",
    );
    expect(compiled.prompt).not.toContain(
      "<d>[Mandarin Chinese] warm adult female voice",
    );
    expect(validateH3GenerationPrompt(compiled.prompt, 15)).toEqual([]);
  });

  it("rejects duplicate hand-authored and structured dialogue", () => {
    expect(() =>
      compileH3StructuredDialoguePrompt(
        "A child (S1) <d>[English] Hello.</d>",
        15,
        [
          {
            segment: 1,
            speakerId: "S1",
            language: "en",
            text: "Hello.",
            delivery: "on_screen",
          },
        ],
      ),
    ).toThrow("不能再包含 <d> 标签");
  });

  it("builds complete segments for a direct multi-segment dialogue request", () => {
    const compiled = compileH3StructuredDialoguePrompt(
      "A mother teaches her child to read across two continuous scenes.",
      30,
      [
        {
          segment: 2,
          speakerId: "S1",
          language: "zh",
          text: "我们再试一次。",
          delivery: "on_screen",
        },
      ],
    );

    expect(compiled.prompt).toContain("=== SEGMENT 1/2 ===");
    expect(compiled.prompt).toContain("=== SEGMENT 2/2 ===");
    expect(compiled.prompt).toContain(
      "(S1) <d>[Mandarin Chinese] 我们再试一次。</d>",
    );
    expect(validateH3GenerationPrompt(compiled.prompt, 30)).toEqual([]);
  });
});
