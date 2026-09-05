import type {
  MediaVideoScriptContinuityBible,
  MediaVideoScriptShot,
} from "@acme/validators";
import {
  mediaVideoScriptContinuityBibleSchema,
  mediaVideoScriptDraftShotSchema,
} from "@acme/validators";

import { H3_I2VA_ALIGNMENT } from "./h3-generation-config";

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

export function buildVideoScriptDraftPrompt(
  input: VideoScriptDraftInput,
): string {
  const suggestedShotCount =
    input.shotCount ??
    Math.min(
      12,
      Math.max(
        1,
        input.targetDurationSeconds <= 15
          ? 1
          : Math.round(input.targetDurationSeconds / 9),
      ),
    );
  return [
    "You are a production script planner for MiniMax H3 native-audio video generation.",
    "Do not inspect files, browse, or use tools. Work only from the supplied brief.",
    "Return one valid JSON object and nothing else. Do not use a Markdown fence.",
    `Create exactly ${suggestedShotCount} shots totaling approximately ${input.targetDurationSeconds} seconds. Prefer 8–10 seconds per shot. Use 5–7 seconds for a simple close-up or reaction, and 11–15 seconds only for one uncomplicated action that genuinely needs the time. Every shot must be independently generatable and no longer than 15 seconds.`,
    "Preserve the requested story, facts, characters, products, visible text, and dialogue. Do not invent unrelated characters, claims, speech, lyrics, or plot events.",
    "Write shot titles in the requested authoring language. Write visualDescription, cameraDirection, continuity, soundscape, and music in precise natural English for H3.",
    `Authoring and dialogue language: ${requestedLanguage(input.language)}. Dialogue text must remain verbatim in that language.`,
    "Use one achievable camera idea and one clear action arc per shot. State concrete subject positions, lighting, environment reactions, and the ending composition.",
    "Continuity must explain what identity, wardrobe, props, layout, lighting, and ending composition carry into the next shot.",
    "Create a concise continuityBible for the entire script. Treat it as fixed production truth shared by every shot.",
    "For each spoken line, choose a stable speakerId S1–S4 and an atSeconds value within that shot. Omit dialogue when the brief does not provide exact words; never invent placeholder or unintelligible speech.",
    "Use N/A for music when no audience-only score was requested.",
    'JSON shape: {"title":"...","continuityBible":{"characters":"...","wardrobeAndProps":"...","locationsAndLighting":"...","visualRules":"..."},"shots":[{"title":"...","durationSeconds":10,"visualDescription":"...","cameraDirection":"...","continuity":"...","soundscape":"...","music":"N/A","dialogues":[{"atSeconds":1.5,"speakerId":"S1","language":"zh","text":"..."}]}]}',
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
  if (!title) throw new Error("脚本 Worker 未返回标题");
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
    continuityBible: continuityResult.data,
    shots,
  };
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
    `[Shot 1] ${shot.visualDescription}${continuityDirection(continuityBible)}`,
    shot.cameraDirection
      ? `Camera direction: ${shot.cameraDirection}`
      : "Camera direction: hold one physically achievable composition and movement.",
    shot.continuity ? `Continuity: ${shot.continuity}` : "",
    ...[...shot.dialogues]
      .sort((a, b) => a.atSeconds - b.atSeconds)
      .map(
        (dialogue) =>
          `At ${timestamp(dialogue.atSeconds)}, (${dialogue.speakerId}) <d>[${dialogue.language === "zh" ? "Mandarin Chinese" : "English"}] ${dialogue.text}</d>`,
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
