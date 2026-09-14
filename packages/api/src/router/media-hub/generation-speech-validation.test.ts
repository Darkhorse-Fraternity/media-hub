import { describe, expect, it } from "vitest";

import {
  extractExpectedH3Dialogue,
  GenerationSpeechValidationError,
  isSpeechValidationInfrastructureError,
  speechMatchScore,
  validateGeneratedDialogue,
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

  it("classifies missing and unavailable ASR as infrastructure failures", async () => {
    const originalUrl = process.env.MEDIA_HUB_ASR_URL;
    delete process.env.MEDIA_HUB_ASR_URL;
    try {
      const error = await validateGeneratedDialogue(
        Buffer.from("video"),
        "(S1) <d>[Mandarin Chinese] 你好。</d>",
        "zh",
      ).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(GenerationSpeechValidationError);
      expect(isSpeechValidationInfrastructureError(error)).toBe(true);
      expect((error as GenerationSpeechValidationError).code).toBe(
        "asr_not_configured",
      );
      expect(
        isSpeechValidationInfrastructureError(
          new GenerationSpeechValidationError("offline", {
            code: "asr_unavailable",
          }),
        ),
      ).toBe(true);
      expect(
        isSpeechValidationInfrastructureError(
          new GenerationSpeechValidationError("mismatch"),
        ),
      ).toBe(false);
    } finally {
      if (originalUrl === undefined) delete process.env.MEDIA_HUB_ASR_URL;
      else process.env.MEDIA_HUB_ASR_URL = originalUrl;
    }
  });
});
