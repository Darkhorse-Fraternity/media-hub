import { describe, expect, it } from "vitest";

import type { MediaVideoScriptShot } from "@acme/db/schema";

import { H3_I2VA_ALIGNMENT } from "./h3-generation-config";
import {
  H3_AV_MAX_RENDER_FRAMES,
  h3ContinuationPrompt,
  h3NativeContinuationFrameCount,
} from "./h3-native-continuation";
import { scriptContinuationSource } from "./video-script-continuation";

const shot = (id: string, durationSeconds = 12): MediaVideoScriptShot => ({
  id,
  durationSeconds,
  title: id,
  visualDescription: "A traveler walks.",
  cameraDirection: "",
  continuity: "",
  soundscape: "",
  music: "N/A",
  dialogues: [],
});

describe("native script continuity", () => {
  it("chains queued shots in script order and requires an approved predecessor for partial reruns", () => {
    const first = shot("a");
    const second = shot("b");
    const third = shot("c");
    const shots = [first, second, third];
    const ids = new Map([
      ["a", "new-a"],
      ["b", "new-b"],
    ]);
    expect(scriptContinuationSource(shots, first, ids, [])).toBeUndefined();
    expect(scriptContinuationSource(shots, second, ids, [])).toBe("new-a");
    expect(() => scriptContinuationSource(shots, third, new Map(), [])).toThrow(
      "上一镜",
    );
    second.selectedGenerationJobId = "chosen-b";
    const takes = [
      {
        id: "latest-b",
        scriptShotId: "b",
        status: "succeeded",
        outputStorageKey: "latest.mp4",
      },
      {
        id: "chosen-b",
        scriptShotId: "b",
        status: "succeeded",
        outputStorageKey: "chosen.mp4",
      },
    ];
    expect(scriptContinuationSource(shots, third, new Map(), takes)).toBe(
      "chosen-b",
    );
    expect(scriptContinuationSource(shots, shot("c", 15), ids, [])).toBe(
      "new-b",
    );
    expect(() =>
      scriptContinuationSource(shots, shot("c", 16), ids, []),
    ).toThrow("15 秒");
  });

  it("budgets the AV prefix in addition to the full fifteen-second shot", () => {
    expect(h3NativeContinuationFrameCount(15)).toBe(396);
    expect(H3_AV_MAX_RENDER_FRAMES).toBe(396);
    expect(h3NativeContinuationFrameCount(14)).toBe(362);
    expect(396 - 22).toBeGreaterThanOrEqual(15 * 24);
    expect(() => h3NativeContinuationFrameCount(16)).toThrow("15 秒");
  });

  it("offsets dialogue across the native context without retaining a false first-frame contract", () => {
    const prompt = h3ContinuationPrompt(
      `${H3_I2VA_ALIGNMENT}\nAt 00:00.000, (S1) <d>[Mandarin Chinese] 出发。</d> At 00:12.500, the bus arrives.`,
    );
    expect(prompt).toContain("At 00:00.917");
    expect(prompt).toContain("At 00:12.500, the bus arrives");
    expect(prompt).toContain("Do not repeat");
    expect(prompt).not.toContain(H3_I2VA_ALIGNMENT);
  });
});
