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
  /\b(?:no|without) (?:dialogue|speech|spoken words?|human voice)\b|无对白|无人声|不说话|保持沉默/i;
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

  if (!dialogueMatches.length && !H3_NO_SPEECH_PATTERN.test(body)) {
    if (H3_AMBIGUOUS_SPEECH_PATTERN.test(body)) {
      issues.push(
        `${label} 包含不可验收的含混人声；请改成无对白，或提供逐字对白标签`,
      );
    } else if (H3_EXPLICIT_SPEECH_PATTERN.test(body)) {
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
