import { z } from "zod/v4";

const dialogueBody = z.object({
  id: z.string().trim().min(1).max(100).optional(),
  at_seconds: z.number().min(0).max(15),
  speaker_id: z.enum(["S1", "S2", "S3", "S4"]),
  language: z.enum(["zh", "en"]),
  text: z.string().trim().min(1).max(300),
});

const continuityBibleObject = z.object({
  characters: z.string().trim().max(3000).default(""),
  wardrobe_and_props: z.string().trim().max(3000).default(""),
  locations_and_lighting: z.string().trim().max(3000).default(""),
  visual_rules: z.string().trim().max(3000).default(""),
});

export const continuityBibleBody = continuityBibleObject.default({
  characters: "",
  wardrobe_and_props: "",
  locations_and_lighting: "",
  visual_rules: "",
});

export const scriptShotBody = z.object({
  id: z.string().trim().min(1).max(100).optional(),
  title: z.string().trim().min(1).max(120),
  duration_seconds: z.number().int().min(5).max(15),
  visual_description: z.string().trim().min(1).max(5000),
  camera_direction: z.string().trim().max(1000).default(""),
  continuity: z.string().trim().max(1000).default(""),
  soundscape: z.string().trim().max(1000).default(""),
  music: z.string().trim().max(1000).default("N/A"),
  dialogues: z.array(dialogueBody).max(6).default([]),
  first_frame_asset_id: z.string().trim().min(1).optional(),
});

export const createScriptBody = z.object({
  title: z.string().trim().min(1).max(200),
  brief: z.string().trim().min(1).max(10_000),
  copy: z.string().trim().max(20_000).default(""),
  copy_status: z.enum(["draft", "approved"]).default("draft"),
  language: z.enum(["zh", "en"]).default("zh"),
  width: z.number().int().min(64).max(1344).default(1344),
  height: z.number().int().min(64).max(1344).default(768),
  default_profile: z.string().trim().min(1).max(200).optional(),
  continuity_bible: continuityBibleBody,
  shots: z.array(scriptShotBody).max(12).default([]),
});

export const patchScriptBody = createScriptBody.partial().extend({
  // Override every defaulted create field. Otherwise Zod applies the create
  // defaults to omitted PATCH properties and a status-only update silently
  // clears the copy, continuity bible, and shots.
  copy: z.string().trim().max(20_000).optional(),
  copy_status: z.enum(["draft", "approved"]).optional(),
  language: z.enum(["zh", "en"]).optional(),
  width: z.number().int().min(64).max(1344).optional(),
  height: z.number().int().min(64).max(1344).optional(),
  default_profile: z.string().trim().min(1).max(200).nullable().optional(),
  continuity_bible: continuityBibleObject.optional(),
  shots: z.array(scriptShotBody).max(12).optional(),
  version: z.number().int().min(1),
});

export const draftScriptBody = z.object({
  title: z.string().trim().max(200).optional(),
  brief: z.string().trim().min(1).max(10_000),
  language: z.enum(["zh", "en"]).default("zh"),
  target_duration_seconds: z.number().int().min(5).max(180).default(30),
  shot_count: z.number().int().min(1).max(12).optional(),
});

export const generateScriptBody = z.object({
  shot_ids: z.array(z.string().trim().min(1)).max(12).default([]),
  quality_preset: z.enum(["fast", "balanced", "quality"]).default("balanced"),
  generation_profile: z.string().trim().min(1).max(200).optional(),
});

export const analyzeScriptBody = z.object({
  shots: z.array(scriptShotBody).max(12),
});

export const bridgeScriptFrameBody = z.object({
  version: z.number().int().min(1),
});

export const createScriptFrameCandidatesBody = z.object({
  output_count: z.number().int().min(1).max(4).default(4),
});

export const selectScriptFrameCandidateBody = z.object({
  asset_id: z.string().trim().min(1).nullable(),
  version: z.number().int().min(1),
});

export function mapContinuityBible(bible: z.infer<typeof continuityBibleBody>) {
  return {
    characters: bible.characters,
    wardrobeAndProps: bible.wardrobe_and_props,
    locationsAndLighting: bible.locations_and_lighting,
    visualRules: bible.visual_rules,
  };
}

export function mapScriptShots(shots: z.infer<typeof scriptShotBody>[]) {
  return shots.map((shot) => ({
    id: shot.id ?? crypto.randomUUID(),
    title: shot.title,
    durationSeconds: shot.duration_seconds,
    visualDescription: shot.visual_description,
    cameraDirection: shot.camera_direction,
    continuity: shot.continuity,
    soundscape: shot.soundscape,
    music: shot.music,
    dialogues: shot.dialogues.map((dialogue) => ({
      id: dialogue.id ?? crypto.randomUUID(),
      atSeconds: dialogue.at_seconds,
      speakerId: dialogue.speaker_id,
      language: dialogue.language,
      text: dialogue.text,
    })),
    firstFrameAssetId: shot.first_frame_asset_id,
  }));
}
