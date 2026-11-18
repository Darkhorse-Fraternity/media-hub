import { describe, expect, it } from "vitest";

import type { MediaVideoScriptShot } from "@acme/validators";

import {
  assembleScriptBody,
  draftScriptBody,
  generateScriptBody,
  mapScriptShots,
  patchScriptBody,
  scriptShotBody,
} from "../lib/agent-video-script";

it("keeps assembly sources, transitions, rebuild and captions together", () => {
  const body = {
    source_job_ids: [crypto.randomUUID(), crypto.randomUUID()],
    transition: "fade_white",
    rebuild: true,
    burn_captions: true,
  };
  expect(assembleScriptBody.parse(body)).toEqual(body);
});

it("preserves native voice direction and lets the selected workflow determine continuity", () => {
  const body = scriptShotBody.parse({
    title: "旁白",
    duration_seconds: 12,
    visual_description: "The traveler boards.",
    dialogues: [
      {
        at_seconds: 1,
        speaker_id: "S1",
        language: "zh",
        text: "出发。",
        voice: "Warm Mandarin narrator.",
        delivery: "off_screen_voiceover",
      },
    ],
  });
  expect(mapScriptShots([body])[0]?.dialogues[0]).toMatchObject({
    voice: "Warm Mandarin narrator.",
    delivery: "off_screen_voiceover",
  });
  expect(generateScriptBody.parse({}).continuity_mode).toBeUndefined();
});

describe("agent video script PATCH schema", () => {
  it("does not inject create defaults into an omitted PATCH field", () => {
    expect(
      patchScriptBody.parse({ version: 3, copy_status: "approved" }),
    ).toEqual({ version: 3, copy_status: "approved" });
  });

  it("keeps the director's take and edit plan during a normal shot PATCH", () => {
    const existing: MediaVideoScriptShot = {
      id: "shot",
      title: "旧标题",
      durationSeconds: 10,
      visualDescription: "Old visual",
      cameraDirection: "",
      continuity: "",
      soundscape: "",
      music: "N/A",
      dialogues: [],
      selectedGenerationJobId: "take-1",
      referenceArtifactId: "11111111-1111-4111-8111-111111111111",
      trimStartSeconds: 1,
      trimEndSeconds: 8,
      captions: [{ id: "cue", startSeconds: 2, endSeconds: 4, text: "字幕" }],
    };
    const patch = scriptShotBody.parse({
      id: "shot",
      title: "新标题",
      duration_seconds: 10,
      visual_description: "New visual",
    });
    expect(mapScriptShots([patch], [existing])[0]).toMatchObject({
      title: "新标题",
      selectedGenerationJobId: "take-1",
      trimStartSeconds: 1,
      trimEndSeconds: 8,
      captions: existing.captions,
      referenceArtifactId: existing.referenceArtifactId,
    });
    expect(
      mapScriptShots(
        [{ ...patch, first_frame_asset_id: "image-1" }],
        [existing],
      )[0],
    ).toMatchObject({
      firstFrameAssetId: "image-1",
      referenceArtifactId: undefined,
    });
    expect(
      mapScriptShots([{ ...patch, reference_artifact_id: null }], [existing])[0]
        ?.referenceArtifactId,
    ).toBeUndefined();
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
