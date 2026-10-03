import { describe, expect, it } from "vitest";

import type { MediaVideoScriptShot } from "@acme/db/schema";

import {
  captionsFromDialogues,
  captionsToSrt,
  cutCaptionCues,
  shotTrim,
} from "./video-script-edit-plan";

const shots: MediaVideoScriptShot[] = [
  {
    id: "first",
    title: "开场",
    durationSeconds: 10,
    visualDescription: "Open",
    cameraDirection: "",
    continuity: "",
    soundscape: "",
    music: "N/A",
    dialogues: [
      {
        id: "line",
        atSeconds: 2,
        speakerId: "S1",
        language: "zh",
        text: "你好",
      },
    ],
    trimStartSeconds: 1,
    trimEndSeconds: 7,
    captions: [
      { id: "caption", startSeconds: 0.5, endSeconds: 3, text: "你好" },
    ],
  },
  {
    id: "second",
    title: "结尾",
    durationSeconds: 5,
    visualDescription: "End",
    cameraDirection: "",
    continuity: "",
    soundscape: "",
    music: "N/A",
    dialogues: [],
    trimStartSeconds: 0,
    trimEndSeconds: 3,
    captions: [
      { id: "caption-2", startSeconds: 1, endSeconds: 5, text: "再见" },
    ],
  },
];

describe("video script edit plan", () => {
  it("maps caption cues into the trimmed timeline and exports SRT", () => {
    const first = shots[0];
    if (!first) throw new Error("Missing first shot");
    expect(shotTrim(first)).toEqual({ start: 1, end: 7, duration: 6 });
    expect(cutCaptionCues(shots)).toEqual([
      { startSeconds: 0, endSeconds: 2, text: "你好" },
      { startSeconds: 7, endSeconds: 9, text: "再见" },
    ]);
    expect(captionsToSrt(shots)).toContain("00:00:07,000 --> 00:00:09,000");
  });

  it("creates editable cues from dialogue timing", () => {
    const first = shots[0];
    if (!first) throw new Error("Missing first shot");
    const generated = captionsFromDialogues(first);
    expect(generated).toMatchObject([{ startSeconds: 2, text: "你好" }]);
    const cue = generated[0];
    if (!cue) throw new Error("Missing generated caption");
    expect(cue.endSeconds).toBeGreaterThan(cue.startSeconds);
  });
});
