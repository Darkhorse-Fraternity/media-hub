import type {
  MediaVideoScriptContinuityBible,
  MediaVideoScriptShot,
} from "@acme/validators";
import {
  mediaVideoScriptContinuityBibleSchema,
  mediaVideoScriptDraftShotSchema,
} from "@acme/validators";

import { H3_I2VA_ALIGNMENT } from "./h3-generation-config";
import { H3_AV_MAX_SHOT_SECONDS } from "./h3-native-continuation";

interface VideoScriptDraftInput {
  title?: string;
  brief: string;
  language: "zh" | "en";
  targetDurationSeconds: number;
  shotCount?: number;
}

function requestedLanguage(value: "zh" | "en"): string {
  return value === "zh" ? "Simplified Chinese" : "English";
}

export function resolveVideoScriptCopyStatus(
  previousCopy: string,
  nextCopy: string,
  requestedStatus: "draft" | "approved",
): "draft" | "approved" {
  return previousCopy === nextCopy ? requestedStatus : "draft";
}

export function preferredH3ScriptShotDurations(
  targetDurationSeconds: number,
): number[] {
  const count = Math.max(
    1,
    Math.ceil(targetDurationSeconds / H3_AV_MAX_SHOT_SECONDS),
  );
  const base = Math.floor(targetDurationSeconds / count);
  const extra = targetDurationSeconds % count;
  return Array.from(
    { length: count },
    (_, index) => base + (index < extra ? 1 : 0),
  );
}

export function buildVideoScriptDraftPrompt(
  input: VideoScriptDraftInput,
): string {
  const preferredDurations = preferredH3ScriptShotDurations(
    input.targetDurationSeconds,
  );
  const suggestedShotCount =
    input.shotCount ?? Math.min(12, Math.max(1, preferredDurations.length));
  const durationPlan = input.shotCount
    ? `The caller explicitly requested ${input.shotCount} shots. Distribute the target duration across that exact count, keeping every shot between 5 and ${H3_AV_MAX_SHOT_SECONDS} seconds. If this is impossible, report the incompatible count instead of exceeding the limit.`
    : `Use this exact duration schedule: ${preferredDurations.join(" + ")} seconds. Reserve 22 frames per continuation for synchronized H3 audio-video context; authored shots must not exceed ${H3_AV_MAX_SHOT_SECONDS} seconds.`;
  return [
    "You are a production script planner for MiniMax H3 native-audio video generation.",
    "Do not inspect files, browse, or use tools. Work only from the supplied brief.",
    "Return one valid JSON object and nothing else. Do not use a Markdown fence.",
    `Create exactly ${suggestedShotCount} shots totaling ${input.targetDurationSeconds} seconds. ${durationPlan} Every shot must be no longer than ${H3_AV_MAX_SHOT_SECONDS} seconds and begin from the preceding shot's ending composition unless a cut is requested.`,
    "Preserve the requested story, facts, characters, products, visible text, and dialogue. Do not invent unrelated characters, claims, speech, lyrics, or plot events.",
    "First write a concise production copy in the requested authoring language. It must express the complete story, intended pacing, and every supplied line of dialogue before the shot breakdown.",
    "Write shot titles in the requested authoring language. Write visualDescription, cameraDirection, continuity, soundscape, and music in precise natural English for H3.",
    `Authoring and dialogue language: ${requestedLanguage(input.language)}. Dialogue text must remain verbatim in that language.`,
    "Use one achievable camera idea and one clear action arc per shot. State concrete subject positions, lighting, environment reactions, and the ending composition.",
    "Make the explanation visible through actions, consequences and environment reactions. Do not turn a video request into static title cards or substitute abstract mechanisms for a supplied human story unless the brief requests that style.",
    "Treat supplied slides as factual source material. Reuse their pictures only when the brief explicitly requires their appearance or identity; slide pictures do not lock the video's visual style.",
    "Continuity must explain what identity, wardrobe, props, layout, lighting, and ending composition carry into the next shot.",
    "Create a concise continuityBible for the entire script. Treat it as fixed production truth shared by every shot.",
    "For each spoken line, choose a stable speakerId S1–S4 and an atSeconds value within that shot. Omit dialogue when the brief does not provide exact words; never invent placeholder or unintelligible speech.",
    "For narration, set delivery to off_screen_voiceover and give each recurring speaker the same voice description across shots. Keep native H3 narration and action sound together; never plan a silent video for replacement with system TTS. Speaker labels alone are not a voice reference; the director supplies synchronized prior-shot context during native continuation.",
    "For a recurring narrator, schedule the final phrase to finish near the shot's end so the synchronized tail contains their audible voice, without cutting off words or exceeding the natural speaking rate.",
    "Use N/A for music when no audience-only score was requested.",
    'JSON shape: {"title":"...","copy":"complete production copy in the requested language","continuityBible":{"characters":"...","wardrobeAndProps":"...","locationsAndLighting":"...","visualRules":"..."},"shots":[{"title":"...","durationSeconds":15,"visualDescription":"...","cameraDirection":"...","continuity":"...","soundscape":"...","music":"N/A","dialogues":[{"atSeconds":1.5,"speakerId":"S1","language":"zh","text":"...","voice":"stable timbre and delivery","delivery":"off_screen_voiceover"}]}]}',
    input.title ? `Working title: ${input.title}` : "",
    "Creative brief:",
    input.brief,
  ]
    .filter(Boolean)
    .join("\n");
}

function stripJsonFence(value: string): string {
  const trimmed = value.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced?.[1]?.trim() ?? trimmed;
}

function parseUnknownJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}

export function parseVideoScriptDraft(value: string): {
  title: string;
  copy: string;
  continuityBible: MediaVideoScriptContinuityBible;
  shots: MediaVideoScriptShot[];
} {
  let parsed: unknown;
  try {
    parsed = parseUnknownJson(stripJsonFence(value));
  } catch {
    throw new Error("脚本 Worker 返回的不是有效 JSON");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("脚本 Worker 返回内容无效");
  }
  const record = parsed as Record<string, unknown>;
  const title = typeof record.title === "string" ? record.title.trim() : "";
  const copy = typeof record.copy === "string" ? record.copy.trim() : "";
  if (!title) throw new Error("脚本 Worker 未返回标题");
  if (!copy) throw new Error("脚本 Worker 未返回文案");
  if (!Array.isArray(record.shots) || record.shots.length === 0) {
    throw new Error("脚本 Worker 未返回镜头");
  }
  const continuityResult = mediaVideoScriptContinuityBibleSchema.safeParse(
    record.continuityBible,
  );
  if (!continuityResult.success) {
    throw new Error("脚本 Worker 返回的连续性设定表格式无效");
  }
  const rawShots = record.shots as unknown[];
  const shots = rawShots.map((shot, index) => {
    const candidate =
      shot && typeof shot === "object"
        ? {
            ...(shot as Record<string, unknown>),
            dialogues: Array.isArray(
              (shot as Record<string, unknown>).dialogues,
            )
              ? ((shot as Record<string, unknown>).dialogues as unknown[]).map(
                  (dialogue) => ({
                    ...(dialogue as Record<string, unknown>),
                    id: crypto.randomUUID(),
                  }),
                )
              : [],
          }
        : shot;
    const result = mediaVideoScriptDraftShotSchema.safeParse(candidate);
    if (!result.success) {
      throw new Error(
        `脚本第 ${index + 1} 镜格式无效：${result.error.issues[0]?.message ?? "未知错误"}`,
      );
    }
    return { id: crypto.randomUUID(), ...result.data };
  });
  return {
    title: title.slice(0, 200),
    copy: copy.slice(0, 20_000),
    continuityBible: continuityResult.data,
    shots,
  };
}

export function buildVideoScriptFirstFramePrompt(
  shot: MediaVideoScriptShot,
  continuityBible?: MediaVideoScriptContinuityBible,
): string {
  return [
    "Create the opening still frame in the visual style requested by the brief and continuity bible. Do not change an illustrated or animated brief into photorealism.",
    shot.visualDescription,
    shot.cameraDirection ? `Composition and lens: ${shot.cameraDirection}` : "",
    continuityBible ? continuityDirection(continuityBible).trim() : "",
    shot.continuity ? `Continuity requirement: ${shot.continuity}` : "",
    "Show the exact opening composition before the described action develops. Preserve character identity, wardrobe, props, spatial layout, lighting, and screen direction. No subtitles, captions, logos, watermarks, UI, or unrequested visible text.",
  ]
    .filter(Boolean)
    .join("\n");
}

function continuityDirection(
  bible: MediaVideoScriptContinuityBible | undefined,
): string {
  if (!bible) return "";
  const entries = (
    [
      ["Character identity", bible.characters],
      ["Wardrobe and props", bible.wardrobeAndProps],
      ["Locations and lighting", bible.locationsAndLighting],
      ["Visual rules", bible.visualRules],
    ] satisfies [string, string][]
  ).filter(([, value]) => value.trim().length > 0);
  if (entries.length === 0) return "";
  return ` Fixed continuity bible: ${entries
    .map(([label, value]) => `${label}: ${value.trim()}`)
    .join("; ")}.`;
}

function timestamp(seconds: number): string {
  const milliseconds = Math.round(seconds * 1000);
  const wholeSeconds = Math.floor(milliseconds / 1000);
  return `00:${String(wholeSeconds).padStart(2, "0")}.${String(milliseconds % 1000).padStart(3, "0")}`;
}

export function compileVideoScriptShotPrompt(
  shot: MediaVideoScriptShot,
  continuityBible?: MediaVideoScriptContinuityBible,
): string {
  const visualParts = [
    `[Shot 1] ${shot.visualDescription.replace(/^\s*\[Shot 1\]\s*/i, "")}${continuityDirection(continuityBible)}`,
    shot.cameraDirection
      ? `Camera direction: ${shot.cameraDirection}`
      : "Camera direction: hold one physically achievable composition and movement.",
    shot.continuity ? `Continuity: ${shot.continuity}` : "",
    ...[...shot.dialogues]
      .sort((a, b) => a.atSeconds - b.atSeconds)
      .map(
        (dialogue) =>
          `At ${timestamp(dialogue.atSeconds)}, ${dialogue.voice ? `Voice direction: ${dialogue.voice}. ` : ""}${dialogue.delivery === "off_screen_voiceover" ? "Off-screen voiceover; visible people do not lip-sync: " : ""}(${dialogue.speakerId}) <d>[${dialogue.language === "zh" ? "Mandarin Chinese" : "English"}] ${dialogue.text}</d>`,
      ),
    `The shot lasts ${shot.durationSeconds} seconds and ends on the composition described above without adding unrequested text, logos, subtitles, or characters.`,
  ].filter(Boolean);
  const prompt = [
    shot.firstFrameAssetId ? `${H3_I2VA_ALIGNMENT}\n` : "",
    `integrated_multimodal_description: ${visualParts.join(" ")}`,
    `overall_soundscape: ${shot.soundscape || "N/A"}`,
    `non_diegetic_music: ${shot.music || "N/A"}`,
  ]
    .filter(Boolean)
    .join("\n");
  return prompt;
}
