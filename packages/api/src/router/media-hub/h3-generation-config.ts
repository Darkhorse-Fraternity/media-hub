import type { MediaH3Dialogue } from "@acme/validators";
import { MEDIA_H3_PROMPT_MAX_LENGTH } from "@acme/validators";

export const DEFAULT_H3_GENERATION_PROFILE = "platform-h3-i2v-inline-v1";
export const DEFAULT_H3_EDIT_PROFILE = "platform-h3-ref2va-edit-v1";
// Backward-compatible alias for callers that still use the original name.
export const H3_PROFILE = DEFAULT_H3_GENERATION_PROFILE;
export const H3_FPS = 24;
export const H3_SEGMENT_FRAMES = 362;
export const H3_SEGMENT_SECONDS = H3_SEGMENT_FRAMES / H3_FPS;
export const H3_I2VA_ALIGNMENT =
  "For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.";

export const h3QualityPresets = {
  fast: {
    steps: 4,
    label: "快速",
    description: "4 步，适合预览构图和动作",
  },
  balanced: {
    steps: 6,
    label: "均衡",
    description: "6 步，匹配当前 Turbo 工作流",
  },
  quality: {
    steps: 8,
    label: "高质量",
    description: "8 步，更重视细节和运动稳定性",
  },
} as const;

export type H3QualityPreset = keyof typeof h3QualityPresets;

export function h3SegmentCount(durationSeconds: number): number {
  return Math.max(1, Math.ceil(durationSeconds / H3_SEGMENT_SECONDS));
}

export function h3StepsForPreset(preset: string): number {
  if (preset === "fast") return h3QualityPresets.fast.steps;
  if (preset === "quality") return h3QualityPresets.quality.steps;
  return h3QualityPresets.balanced.steps;
}

interface ParsedSegment {
  index: number;
  total: number;
  prompt: string;
}

const H3_PROMPT_FIELDS = [
  "integrated_multimodal_description:",
  "overall_soundscape:",
  "non_diegetic_music:",
] as const;

const H3_EXPLICIT_SPEECH_PATTERN =
  /\b(?:says?|speaks?|reads? aloud|dialogue|spoken words?)\b|朗读|说(?:道|话)?|对白|台词/i;
const H3_NO_SPEECH_PATTERN =
  /\b(?:no|without) (?:dialogue|speech|spoken words?|human voice)\b|无对白|无人声|不说话|保持沉默/gi;
const H3_AMBIGUOUS_SPEECH_PATTERN =
  /\b(?:indistinct|unintelligible|incomprehensible|gibberish|babbl(?:e|ing)|murmur(?:s|ing)?)\b|含混|听不清|不可辨识|无法辨认|模糊人声|低声朗读/i;

function validatePromptBody(body: string, label: string): string[] {
  const issues: string[] = [];
  const fieldIndexes = H3_PROMPT_FIELDS.map((field) => body.indexOf(field));
  const [descriptionIndex = -1, soundscapeIndex = -1, musicIndex = -1] =
    fieldIndexes;
  if (fieldIndexes.some((index) => index >= 0)) {
    if (fieldIndexes.some((index) => index < 0)) {
      issues.push(`${label} 必须同时包含 H3 的三个顶层字段`);
    } else if (
      !(descriptionIndex < soundscapeIndex && soundscapeIndex < musicIndex)
    ) {
      issues.push(`${label} 的 H3 顶层字段顺序不正确`);
    }
  }

  const dialogueOpenCount = body.match(/<d>/g)?.length ?? 0;
  const dialogueCloseCount = body.match(/<\/d>/g)?.length ?? 0;
  const dialoguePattern = /<d>\[([^\]]+)]\s*([^<]+?)<\/d>/g;
  const dialogueMatches = [...body.matchAll(dialoguePattern)];
  if (
    dialogueOpenCount !== dialogueCloseCount ||
    dialogueMatches.length !== dialogueOpenCount
  ) {
    issues.push(
      `${label} 的对白必须使用完整格式：(S1) <d>[Language] 逐字台词</d>`,
    );
  }
  for (const match of dialogueMatches) {
    const index = match.index;
    const prefix = body.slice(Math.max(0, index - 48), index);
    if (!/\(S\d+\)\s*$/.test(prefix)) {
      issues.push(`${label} 的每句对白都必须紧邻稳定说话人 ID，例如 (S1)`);
      break;
    }
    if (!match[1]?.trim() || !match[2]?.trim()) {
      issues.push(`${label} 的对白语言和逐字内容不能为空`);
      break;
    }
  }

  if (!dialogueMatches.length) {
    const speechDirections = body.replace(H3_NO_SPEECH_PATTERN, "");
    if (H3_AMBIGUOUS_SPEECH_PATTERN.test(speechDirections)) {
      issues.push(
        `${label} 包含不可验收的含混人声；请改成无对白，或提供逐字对白标签`,
      );
    } else if (H3_EXPLICIT_SPEECH_PATTERN.test(speechDirections)) {
      issues.push(
        `${label} 要求人物说话但没有逐字对白；请使用 (S1) <d>[Language] 台词</d>`,
      );
    }
  }
  return issues;
}

function parseMarkedSegments(prompt: string): ParsedSegment[] {
  const marker = /^===\s*SEGMENT\s+(\d+)\s*\/\s*(\d+)\s*===\s*$/gim;
  const matches = [...prompt.matchAll(marker)];
  return matches.map((match, matchIndex) => {
    const start = match.index + match[0].length;
    const end = matches[matchIndex + 1]?.index ?? prompt.length;
    return {
      index: Number(match[1]),
      total: Number(match[2]),
      prompt: prompt.slice(start, end).trim(),
    };
  });
}

function normalizedStructuredDialogues(
  dialogues: MediaH3Dialogue[],
): MediaH3Dialogue[] {
  const normalizedSpeakerByInput = new Map<
    MediaH3Dialogue["speakerId"],
    string
  >();
  const chronological = dialogues
    .map((dialogue, inputIndex) => ({ dialogue, inputIndex }))
    .sort(
      (left, right) =>
        left.dialogue.segment - right.dialogue.segment ||
        left.inputIndex - right.inputIndex,
    )
    .map(({ dialogue }) => dialogue);
  return chronological.map((dialogue) => {
    let speakerId = normalizedSpeakerByInput.get(dialogue.speakerId);
    if (!speakerId) {
      speakerId = `S${normalizedSpeakerByInput.size + 1}`;
      normalizedSpeakerByInput.set(dialogue.speakerId, speakerId);
    }
    return {
      ...dialogue,
      speakerId: speakerId as MediaH3Dialogue["speakerId"],
    };
  });
}

function structuredDialogueLine(dialogue: MediaH3Dialogue): string {
  const language = dialogue.language === "zh" ? "Mandarin Chinese" : "English";
  const voice = dialogue.voice ? `Voice direction: ${dialogue.voice}. ` : "";
  const delivery =
    dialogue.delivery === "off_screen_voiceover"
      ? "Off-screen voiceover; every visible person keeps their mouth closed: "
      : "On-screen delivery with natural lip synchronization: ";
  return `${voice}${delivery}(${dialogue.speakerId}) <d>[${language}] ${dialogue.text}</d>`;
}

function injectStructuredDialogue(
  body: string,
  dialogues: MediaH3Dialogue[],
): string {
  const lines = dialogues.map(structuredDialogueLine).join("\n");
  const dialogueBlock = lines ? `Structured dialogue:\n${lines}` : "";
  const soundscapeIndex = body.indexOf("overall_soundscape:");
  const hasCompleteContract = H3_PROMPT_FIELDS.every((field) =>
    body.includes(field),
  );
  if (hasCompleteContract && soundscapeIndex >= 0) {
    if (!dialogueBlock) return body.trim();
    return `${body.slice(0, soundscapeIndex).trimEnd()}\n${dialogueBlock}\n${body.slice(soundscapeIndex).trimStart()}`;
  }
  return [
    `integrated_multimodal_description: ${body.trim()}`,
    dialogueBlock || undefined,
    dialogues.length
      ? "overall_soundscape: Preserve synchronized ambience and physical-action sounds without adding dialogue."
      : "overall_soundscape: No dialogue. Preserve synchronized ambience and physical-action sounds.",
    "non_diegetic_music: N/A",
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

/**
 * Compile authoritative dialogue fields into the H3 prompt without trusting
 * callers to hand-author speaker order, language tags, or voiceover behavior.
 */
export function compileH3StructuredDialoguePrompt(
  prompt: string,
  durationSeconds: number,
  dialogues: MediaH3Dialogue[],
): { prompt: string; dialogues: MediaH3Dialogue[] } {
  if (!dialogues.length) return { prompt: prompt.trim(), dialogues: [] };
  if (/<\/?d>/i.test(prompt)) {
    throw new Error(
      "使用 dialogues[] 时 prompt 不能再包含 <d> 标签；逐字对白由服务端统一编译",
    );
  }
  const normalizedDialogues = normalizedStructuredDialogues(dialogues);
  const segmentCount = h3SegmentCount(durationSeconds);
  const marked = parseMarkedSegments(prompt);
  if (marked.length && marked.length !== segmentCount) {
    throw new Error(
      `${durationSeconds} 秒视频需要 ${segmentCount} 个完整分段后才能编译结构化对白`,
    );
  }
  if (segmentCount > 1) {
    const sourceSegments = marked.length
      ? marked
      : h3SegmentPrompts(prompt, segmentCount).map((segmentPrompt, index) => ({
          index: index + 1,
          total: segmentCount,
          prompt: segmentPrompt,
        }));
    const compiled = sourceSegments.map((segment) => {
      const segmentDialogues = normalizedDialogues.filter(
        (dialogue) => dialogue.segment === segment.index,
      );
      return `=== SEGMENT ${segment.index}/${segment.total} ===\n${injectStructuredDialogue(segment.prompt, segmentDialogues)}`;
    });
    return { prompt: compiled.join("\n\n"), dialogues: normalizedDialogues };
  }
  if (marked.length) {
    const [segment] = marked;
    if (!segment) throw new Error("单段视频的 SEGMENT 标记不完整");
    return {
      prompt: `=== SEGMENT 1/1 ===\n${injectStructuredDialogue(segment.prompt, normalizedDialogues)}`,
      dialogues: normalizedDialogues,
    };
  }
  return {
    prompt: injectStructuredDialogue(
      prompt,
      normalizedDialogues.filter((dialogue) => dialogue.segment === 1),
    ),
    dialogues: normalizedDialogues,
  };
}

/**
 * 在占用 GPU 前检查 H3 结构和对白是否可验收。
 * 单段仍兼容简短自然语言描述；一旦使用结构化字段就执行完整契约检查。
 */
export function validateH3GenerationPrompt(
  prompt: string,
  durationSeconds: number,
): string[] {
  const requestedSegments = h3SegmentCount(durationSeconds);
  const marked = parseMarkedSegments(prompt);
  if (requestedSegments > 1) {
    const complete =
      marked.length === requestedSegments &&
      marked.every(
        (segment, index) =>
          segment.index === index + 1 &&
          segment.total === requestedSegments &&
          segment.prompt.length > 0,
      );
    if (!complete) {
      return [
        `${durationSeconds} 秒视频需要 ${requestedSegments} 个完整分段，请先优化提示词并使用 === SEGMENT N/${requestedSegments} === 标记`,
      ];
    }
    return marked.flatMap((segment) => {
      const label = `SEGMENT ${segment.index}/${segment.total}`;
      const issues = validatePromptBody(segment.prompt, label);
      const hasAllFields = H3_PROMPT_FIELDS.every((field) =>
        segment.prompt.includes(field),
      );
      return hasAllFields
        ? issues
        : [...issues, `${label} 必须使用完整 H3 三字段契约`];
    });
  }

  if (marked.length) {
    const completeSingle =
      marked.length === 1 &&
      marked[0]?.index === 1 &&
      marked[0].total === 1 &&
      Boolean(marked[0].prompt);
    if (!completeSingle) return ["单段视频的 SEGMENT 标记不完整"];
    return validatePromptBody(marked[0]?.prompt ?? "", "SEGMENT 1/1");
  }
  return validatePromptBody(prompt.trim(), "提示词");
}

export function isH3SpeechIssue(issue: string): boolean {
  return (
    issue.includes("对白必须使用完整格式") ||
    issue.includes("要求人物说话但没有逐字对白") ||
    issue.includes("对白语言和逐字内容不能为空") ||
    issue.includes("每句对白都必须紧邻稳定说话人 ID") ||
    issue.includes("不可验收的含混人声")
  );
}

export function formatH3PromptIssues(
  issues: string[],
  noDialogueRequested = false,
): string {
  if (noDialogueRequested && issues.every(isH3SpeechIssue)) {
    return "AI 优化后的提示词擅自加入了对白，自动修正未成功。请重试生成；无需填写台词。";
  }
  const readable = issues.map((issue) =>
    issue
      .replace(/SEGMENT\s+(\d+)\/\d+/, "第 $1 段")
      .replace(/的对白必须使用完整格式：.*/, "出现了未指定或格式错误的对白")
      .replace(/要求人物说话但没有逐字对白；.*/, "描述了说话，但没有具体台词"),
  );
  return `提示词需要调整：${readable.join("；")}。如果不需要人物说话，请在描述中注明全程无对白；需要说话时，请在「原声台词」填写对应分段的实际台词。`;
}

export function buildH3NoDialogueRepairPrompt(
  prompt: string,
  durationSeconds: number,
  issues: string[],
): string {
  return [
    "Correct the following MiniMax H3 production prompt. Return only the corrected prompt text.",
    `Target duration: ${durationSeconds} seconds.`,
    "The user provided no exact dialogue. Every segment must be completely silent with respect to speech: no spoken words, lyrics, voiceover, lip-sync, or dialogue tags. Do not invent dialogue. If someone was described as speaking or reading aloud, keep the visual action but make it silent. Explicitly state No dialogue in each segment's overall_soundscape.",
    "Preserve the visual subjects, actions, shot timing, continuity, and the three H3 top-level fields in their original order. Preserve every SEGMENT marker exactly.",
    `Validation issues: ${issues.join("; ")}`,
    "Prompt to correct:",
    prompt,
  ].join("\n");
}

export async function repairH3NoDialoguePrompt(
  prompt: string,
  durationSeconds: number,
  query: (instruction: string, maxLength: number) => Promise<string>,
): Promise<string | null> {
  const issues = validateH3GenerationPrompt(prompt, durationSeconds);
  if (!issues.length && !/<\/?d>/i.test(prompt)) return prompt;

  const corrected = await query(
    buildH3NoDialogueRepairPrompt(prompt, durationSeconds, issues),
    MEDIA_H3_PROMPT_MAX_LENGTH,
  );
  if (
    /<\/?d>/i.test(corrected) ||
    validateH3GenerationPrompt(corrected, durationSeconds).length > 0
  ) {
    return null;
  }
  return corrected;
}

export function h3SegmentPrompts(
  prompt: string,
  requestedSegments: number,
): string[] {
  const count = Math.max(1, requestedSegments);
  const marked = parseMarkedSegments(prompt);
  const isComplete =
    marked.length === count &&
    marked.every(
      (segment, index) =>
        segment.index === index + 1 &&
        segment.total === count &&
        segment.prompt.length > 0,
    );
  if (isComplete) return marked.map((segment) => segment.prompt);
  if (count === 1) return [prompt.trim()];

  return Array.from({ length: count }, (_, index) => {
    const segmentNumber = index + 1;
    const continuity =
      index === 0
        ? "Establish the subject, visual identity, spatial layout, and motion direction so they can remain stable in later segments."
        : "Treat the supplied first frame as the exact ending frame of the previous segment. Preserve identity, wardrobe, props, lighting, lens, screen direction, subject position, and motion momentum; continue the action without a reset or repeated establishing shot.";
    return [
      `Continuation segment ${segmentNumber} of ${count}.`,
      continuity,
      "Plan this segment as a self-contained 15-second production prompt with concrete shot timestamps, synchronized sound, and an ending composition that the next segment can continue.",
      prompt.trim(),
    ].join("\n");
  });
}
