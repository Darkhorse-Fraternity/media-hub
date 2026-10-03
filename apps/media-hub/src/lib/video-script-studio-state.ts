import type {
  MEDIA_H3_SCRIPT_TARGET_DURATIONS,
  MediaVideoScriptContinuityBible,
  MediaVideoScriptShot,
} from "@acme/validators";
import { MEDIA_H3_SCRIPT_SHOT_SECONDS } from "@acme/validators";

export type ScriptLanguage = "zh" | "en";
export type QualityPreset = "fast" | "balanced" | "quality";
export type CopyStatus = "draft" | "approved";
export type ScriptTargetDuration =
  (typeof MEDIA_H3_SCRIPT_TARGET_DURATIONS)[number];

export const EMPTY_CONTINUITY_BIBLE: MediaVideoScriptContinuityBible = {
  characters: "",
  wardrobeAndProps: "",
  locationsAndLighting: "",
  visualRules: "",
};

export function emptyShot(position: number): MediaVideoScriptShot {
  return {
    id: crypto.randomUUID(),
    title: `镜头 ${position}`,
    durationSeconds: MEDIA_H3_SCRIPT_SHOT_SECONDS,
    visualDescription: "",
    cameraDirection: "",
    continuity: "",
    soundscape: "",
    music: "N/A",
    dialogues: [],
  };
}
