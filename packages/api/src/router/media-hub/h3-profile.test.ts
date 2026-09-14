import { describe, expect, it } from "vitest";

import { createMediaGenerationSchema } from "@acme/validators";

import { h3ReferenceAudioCapabilityIssue } from "./h3-reference-audio";

describe("H3 generation input capabilities", () => {
  it("rejects dialogue that cannot fit in its segment", () => {
    const parsed = createMediaGenerationSchema.safeParse({
      prompt: "A child talks.",
      durationSeconds: 5,
      dialogues: [
        {
          segment: 1,
          speakerId: "S1",
          language: "zh",
          text: "这是一段明显无法在五秒之内自然说完的很长很长的中文逐字对白。",
        },
      ],
    });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toContain("超过可用的 5 秒");
  });

  it("reports that bundled profiles cannot bind standalone reference audio", () => {
    expect(
      h3ReferenceAudioCapabilityIssue("platform-h3-i2v-inline-v1", 1, 0),
    ).toContain("不支持独立参考音频");
    expect(
      h3ReferenceAudioCapabilityIssue("future-audio-profile", 1, 2),
    ).toBeNull();
  });
});
