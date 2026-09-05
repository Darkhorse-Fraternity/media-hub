import { describe, expect, it } from "vitest";

import { analyzeMediaVideoScriptShots } from "@acme/validators";

import { validateH3GenerationPrompt } from "./h3-generation-config";
import {
  buildVideoScriptDraftPrompt,
  compileVideoScriptShotPrompt,
  parseVideoScriptDraft,
} from "./video-script-core";

describe("video script core", () => {
  it("asks for independently generatable H3 shots", () => {
    const prompt = buildVideoScriptDraftPrompt({
      brief: "A mother teaches her child to read",
      language: "zh",
      targetDurationSeconds: 30,
    });
    expect(prompt).toContain("exactly 3 shots");
    expect(prompt).toContain("Prefer 8–10 seconds");
    expect(prompt).toContain("stable speakerId");
    expect(prompt).toContain("continuityBible");
  });

  it("parses a structured draft and supplies stable ids", () => {
    const draft = parseVideoScriptDraft(
      JSON.stringify({
        title: "识字时间",
        continuityBible: {
          characters: "Mother S1 and child S2 keep the same faces.",
          wardrobeAndProps: "Beige cardigan, green sweater, workbook.",
          locationsAndLighting: "Warm desk lamp in the study.",
          visualRules: "Naturalistic family drama.",
        },
        shots: [
          {
            title: "开始",
            durationSeconds: 10,
            visualDescription: "A mother and child sit at a desk.",
            cameraDirection: "A restrained slow push-in.",
            continuity: "Keep wardrobe and desk layout unchanged.",
            soundscape: "Quiet room tone and page turns.",
            music: "N/A",
            dialogues: [
              {
                atSeconds: 2,
                speakerId: "S1",
                language: "zh",
                text: "我们再读一次。",
              },
            ],
          },
        ],
      }),
    );
    expect(draft.shots[0]?.id).toBeTruthy();
    expect(draft.shots[0]?.dialogues[0]?.id).toBeTruthy();
    expect(draft.continuityBible.characters).toContain("Mother");
  });

  it("compiles exact H3 fields and native-audio dialogue", () => {
    const prompt = compileVideoScriptShotPrompt(
      {
        id: "shot-1",
        title: "开始",
        durationSeconds: 10,
        visualDescription: "A mother points to a workbook.",
        cameraDirection: "Medium two-shot with a slow push-in.",
        continuity: "Keep both faces and clothing unchanged.",
        soundscape: "Quiet room tone and paper movement.",
        music: "N/A",
        dialogues: [
          {
            id: "line-1",
            atSeconds: 2,
            speakerId: "S1",
            language: "zh",
            text: "跟我读。",
          },
        ],
      },
      {
        characters: "S1 is the same mother in every shot.",
        wardrobeAndProps: "Beige cardigan.",
        locationsAndLighting: "Warm study.",
        visualRules: "Photorealistic.",
      },
    );
    expect(prompt).toContain("integrated_multimodal_description: [Shot 1]");
    expect(prompt).toContain("(S1) <d>[Mandarin Chinese] 跟我读。</d>");
    expect(prompt).toContain("Fixed continuity bible");
    expect(prompt.indexOf("overall_soundscape:")).toBeLessThan(
      prompt.indexOf("non_diegetic_music:"),
    );
    expect(validateH3GenerationPrompt(prompt, 10)).toEqual([]);
  });

  it("warns when original dialogue cannot fit its spoken window", () => {
    const issues = analyzeMediaVideoScriptShots([
      {
        id: "shot-1",
        title: "快台词",
        durationSeconds: 8,
        visualDescription: "A child reads from a workbook.",
        cameraDirection: "Static medium shot.",
        continuity: "Keep identity stable.",
        soundscape: "Room tone.",
        music: "N/A",
        dialogues: [
          {
            id: "line-1",
            atSeconds: 7,
            speakerId: "S2",
            language: "zh",
            text: "这是一句不可能在一秒钟内自然说完的台词",
          },
        ],
      },
    ]);
    expect(issues[0]).toMatchObject({
      code: "dialogue_too_fast",
      shotId: "shot-1",
      dialogueId: "line-1",
    });
  });
});
