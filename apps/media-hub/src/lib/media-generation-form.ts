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
