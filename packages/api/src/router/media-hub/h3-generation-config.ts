export const H3_PROFILE = "platform-h3-i2v-inline-v1";
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
