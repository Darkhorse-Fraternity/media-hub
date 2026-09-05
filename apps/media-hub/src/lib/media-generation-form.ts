export type ReferenceImageRole = "first_frame" | "style" | "subject";
export type ReferenceImageContentType =
  | "image/jpeg"
  | "image/png"
  | "image/webp";

export interface ReferenceImageDraft {
  id: string;
  file?: File;
  asset?: {
    id: string;
    name: string;
    contentType: ReferenceImageContentType;
    sizeBytes: number;
  };
  previewUrl: string;
  role: ReferenceImageRole;
}

export interface H3DialogueLine {
  segment: number;
  speakerId: "S1" | "S2" | "S3" | "S4";
  language: "zh" | "en";
  text: string;
}

function h3DialogueTag(dialogue: H3DialogueLine): string {
  const language = dialogue.language === "zh" ? "Mandarin Chinese" : "English";
  return `(${dialogue.speakerId}) <d>[${language}] ${dialogue.text.trim()}</d>`;
}

export function h3PromptContainsDialogues(
  prompt: string,
  dialogues: H3DialogueLine[],
  durationSeconds: number,
): boolean {
  if (dialogues.length === 0) return true;
  const segmentCount = Math.max(1, Math.ceil(durationSeconds / 15));
  const markers = [
    ...prompt.matchAll(/^===\s*SEGMENT\s+(\d+)\s*\/\s*(\d+)\s*===\s*$/gim),
  ];
  const segmentBodies = new Map<number, string>();
  if (segmentCount === 1 && markers.length === 0) {
    segmentBodies.set(1, prompt);
  } else {
    markers.forEach((marker, index) => {
      const start = marker.index + marker[0].length;
      const end = markers[index + 1]?.index ?? prompt.length;
      segmentBodies.set(Number(marker[1]), prompt.slice(start, end));
    });
  }
  return dialogues.every((dialogue) =>
    segmentBodies.get(dialogue.segment)?.includes(h3DialogueTag(dialogue)),
  );
}

const h3PromptFields = [
  "integrated_multimodal_description:",
  "overall_soundscape:",
  "non_diegetic_music:",
] as const;

/**
 * Decide whether the browser should normalize a prompt before submitting it.
 * The API remains the authoritative validator; this avoids a predictable
 * round-trip failure for raw or incomplete long-form prompts.
 */
export function shouldOptimizeH3PromptBeforeSubmit(
  prompt: string,
  durationSeconds: number,
): boolean {
  const fieldIndexes = h3PromptFields.map((field) => prompt.indexOf(field));
  const fieldsAreCompleteAndOrdered = fieldIndexes.every(
    (index, fieldIndex) =>
      index >= 0 &&
      (fieldIndex === 0 || index > (fieldIndexes[fieldIndex - 1] ?? -1)),
  );
  if (!fieldsAreCompleteAndOrdered) return true;

  const segmentCount = Math.max(1, Math.ceil(durationSeconds / 15));
  if (segmentCount === 1) return false;

  const markers = [
    ...prompt.matchAll(/^===\s*SEGMENT\s+(\d+)\s*\/\s*(\d+)\s*===\s*$/gim),
  ];
  return !(
    markers.length === segmentCount &&
    markers.every(
      (marker, index) =>
        Number(marker[1]) === index + 1 && Number(marker[2]) === segmentCount,
    )
  );
}

interface UploadedReferenceImage {
  key: string;
  contentType: ReferenceImageContentType;
}

export const referenceImageContentTypes = new Set<ReferenceImageContentType>([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

let referenceImageIdCounter = 0;

export function createReferenceImageDraftId(): string {
  const runtimeCrypto = Reflect.get(globalThis, "crypto") as
    | { randomUUID?: () => string }
    | undefined;
  if (typeof runtimeCrypto?.randomUUID === "function") {
    return runtimeCrypto.randomUUID();
  }
  return `reference-${Date.now()}-${(referenceImageIdCounter += 1)}`;
}

export async function uploadReferenceImage(
  file: File,
): Promise<UploadedReferenceImage> {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let response: Response;
    try {
      const formData = new FormData();
      formData.set("file", file);
      response = await fetch("/api/media-hub/uploads/reference-image", {
        method: "POST",
        body: formData,
      });
    } catch {
      if (attempt < 2) continue;
      throw new Error(`参考图片“${file.name}”上传服务连接失败，请稍后重试。`);
    }

    if (response.ok) {
      const payload = (await response.json()) as {
        key?: unknown;
        contentType?: unknown;
      };
      if (
        typeof payload.key !== "string" ||
        !referenceImageContentTypes.has(
          payload.contentType as ReferenceImageContentType,
        )
      ) {
        throw new Error(`参考图片“${file.name}”上传响应无效，请稍后重试。`);
      }
      return {
        key: payload.key,
        contentType: payload.contentType as ReferenceImageContentType,
      };
    }
    if (response.status >= 500 && attempt < 2) continue;
    const payload = (await response.json().catch(() => null)) as {
      error?: unknown;
    } | null;
    const reason =
      typeof payload?.error === "string" ? `：${payload.error}` : "";
    throw new Error(
      `参考图片“${file.name}”上传失败（HTTP ${response.status}${reason}）`,
    );
  }

  throw new Error(`参考图片“${file.name}”上传失败，请稍后重试。`);
}

export const scheduleDayOptions = [
  { value: "now", label: "立即执行" },
  { value: "0", label: "今天" },
  { value: "1", label: "明天" },
  { value: "2", label: "后天" },
  { value: "3", label: "3 天后" },
  { value: "4", label: "4 天后" },
  { value: "5", label: "5 天后" },
  { value: "6", label: "6 天后" },
  { value: "7", label: "7 天后" },
] as const;

export const scheduleTimeOptions = Array.from({ length: 48 }, (_, index) => {
  const hour = Math.floor(index / 2)
    .toString()
    .padStart(2, "0");
  const minute = index % 2 === 0 ? "00" : "30";
  const value = `${hour}:${minute}`;
  return { value, label: value };
});

export function resolveScheduledAt(day: string, time: string): Date | null {
  if (day === "now") return null;
  const [hour = 0, minute = 0] = time.split(":").map(Number);
  const scheduledAt = new Date();
  scheduledAt.setDate(scheduledAt.getDate() + Number(day));
  scheduledAt.setHours(hour, minute, 0, 0);
  return scheduledAt;
}
