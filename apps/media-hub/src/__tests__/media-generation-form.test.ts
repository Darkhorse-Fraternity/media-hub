import { describe, expect, it } from "vitest";

import {
  h3PromptContainsDialogues,
  shouldOptimizeH3PromptBeforeSubmit,
} from "../lib/media-generation-form";

const h3Body = [
  "integrated_multimodal_description: [Shot 1] A child reads silently.",
  "overall_soundscape: A quiet room.",
  "non_diegetic_music: N/A",
].join("\n");

describe("media generation form", () => {
  it("normalizes raw and incomplete H3 prompts before submission", () => {
    expect(shouldOptimizeH3PromptBeforeSubmit("A child reads.", 15)).toBe(true);
    expect(
      shouldOptimizeH3PromptBeforeSubmit(
        "overall_soundscape: Quiet\nintegrated_multimodal_description: Child\nnon_diegetic_music: N/A",
        15,
      ),
    ).toBe(true);
  });

  it("accepts a complete single-segment H3 prompt", () => {
    expect(shouldOptimizeH3PromptBeforeSubmit(h3Body, 15)).toBe(false);
  });

  it("requires every ordered segment marker for long-form prompts", () => {
    expect(
      shouldOptimizeH3PromptBeforeSubmit(`=== SEGMENT 1/2 ===\n${h3Body}`, 30),
    ).toBe(true);
    expect(
      shouldOptimizeH3PromptBeforeSubmit(
        `=== SEGMENT 1/2 ===\n${h3Body}\n=== SEGMENT 2/2 ===\n${h3Body}`,
        30,
      ),
    ).toBe(false);
  });

  it("checks exact dialogue text inside its assigned H3 segment", () => {
    const prompt = [
      `=== SEGMENT 1/2 ===\n${h3Body}\n(S1) <d>[Mandarin Chinese] 跟我读，春天来了。</d>`,
      `=== SEGMENT 2/2 ===\n${h3Body}\n(S2) <d>[Mandarin Chinese] 春天来了。</d>`,
    ].join("\n");
    const dialogues = [
      {
        segment: 1,
        speakerId: "S1" as const,
        language: "zh" as const,
        text: "跟我读，春天来了。",
      },
      {
        segment: 2,
        speakerId: "S2" as const,
        language: "zh" as const,
        text: "春天来了。",
      },
    ];

    expect(h3PromptContainsDialogues(prompt, dialogues, 30)).toBe(true);
    expect(
      h3PromptContainsDialogues(prompt, [{ ...dialogues[1]!, segment: 1 }], 30),
    ).toBe(false);
  });
});
