export const maxReferenceImageBytes = 5_000_000;
export const maxReferenceImageMegabytes = maxReferenceImageBytes / 1_000_000;

const initialMaxDimension = 2_560;
const minimumMaxDimension = 640;
const initialQuality = 0.86;
const minimumQuality = 0.58;
const maxCompressionAttempts = 6;

export interface ReferenceImageCompressionResult {
  file: File;
  compressed: boolean;
  originalBytes: number;
}

export function calculateContainedDimensions(
  width: number,
  height: number,
  maxDimension: number,
): { width: number; height: number } {
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function formatImageBytes(bytes: number): string {
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1_000))} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function compressedFilename(filename: string): string {
  const stem = filename.replace(/\.[^./]+$/, "") || "reference-image";
  return `${stem}-compressed.webp`;
}

function encodeCanvas(
  canvas: HTMLCanvasElement,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("浏览器无法编码 WebP 图片"));
      },
      "image/webp",
      quality,
    );
  });
}

export async function compressReferenceImage(
  file: File,
): Promise<ReferenceImageCompressionResult> {
  if (file.size <= maxReferenceImageBytes) {
    return { file, compressed: false, originalBytes: file.size };
  }

  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("浏览器无法创建图片画布");

    let maxDimension = Math.min(
      initialMaxDimension,
      Math.max(bitmap.width, bitmap.height),
    );
    let quality = initialQuality;

    for (let attempt = 0; attempt < maxCompressionAttempts; attempt += 1) {
      const dimensions = calculateContainedDimensions(
        bitmap.width,
        bitmap.height,
        maxDimension,
      );
      canvas.width = dimensions.width;
      canvas.height = dimensions.height;
      context.clearRect(0, 0, dimensions.width, dimensions.height);
      context.drawImage(bitmap, 0, 0, dimensions.width, dimensions.height);

      const blob = await encodeCanvas(canvas, quality);
      if (blob.size <= maxReferenceImageBytes) {
        return {
          file: new File([blob], compressedFilename(file.name), {
            type: "image/webp",
            lastModified: Date.now(),
          }),
          compressed: true,
          originalBytes: file.size,
        };
      }

      maxDimension = Math.max(
        minimumMaxDimension,
        Math.floor(maxDimension * 0.8),
      );
      quality = Math.max(minimumQuality, quality - 0.07);
    }
  } catch (error) {
    const detail = error instanceof Error ? `：${error.message}` : "";
    throw new Error(`图片“${file.name}”自动压缩失败${detail}`);
  } finally {
    bitmap?.close();
  }

  throw new Error(
    `图片“${file.name}”压缩后仍超过 ${maxReferenceImageMegabytes} MB，请换一张图片。`,
  );
}
