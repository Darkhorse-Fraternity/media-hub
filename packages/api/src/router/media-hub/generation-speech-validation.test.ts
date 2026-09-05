import { describe, expect, it } from "vitest";

import {
  extractExpectedH3Dialogue,
  speechMatchScore,
} from "./generation-speech-validation";

describe("H3 original-audio dialogue validation", () => {
  it("extracts only exact H3 dialogue tags", () => {
    expect(
      extractExpectedH3Dialogue(
        "A mother (S1) <d>[Mandarin Chinese] 跟我读，春天来了。</d> The child (S2) <d>[Mandarin Chinese] 春天来了。</d>",
      ),
    ).toEqual(["跟我读，春天来了。", "春天来了。"]);
  });

  it("ignores punctuation and spacing when comparing Mandarin speech", () => {
    expect(speechMatchScore("妈妈，我不会。", "妈妈 我不会")).toBe(1);
    expect(speechMatchScore("春天来了", "冬天走了")).toBeLessThan(0.72);
  });
});
