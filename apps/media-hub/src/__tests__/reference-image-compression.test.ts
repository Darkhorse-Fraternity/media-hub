import { afterEach, describe, expect, it, vi } from "vitest";

import {
  calculateContainedDimensions,
  compressReferenceImage,
  formatImageBytes,
} from "../lib/reference-image-compression";

describe("reference image compression", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps image aspect ratio while fitting the maximum dimension", () => {
    expect(calculateContainedDimensions(4_000, 3_000, 2_560)).toEqual({
      width: 2_560,
      height: 1_920,
    });
    expect(calculateContainedDimensions(800, 1_200, 2_560)).toEqual({
      width: 800,
      height: 1_200,
    });
  });

  it("formats image sizes for upload feedback", () => {
    expect(formatImageBytes(850_000)).toBe("850 KB");
    expect(formatImageBytes(6_250_000)).toBe("6.3 MB");
  });

  it("leaves images within the upload limit unchanged", async () => {
    const file = new File([new Uint8Array(32)], "reference.png", {
      type: "image/png",
    });

    await expect(compressReferenceImage(file)).resolves.toEqual({
      file,
      compressed: false,
      originalBytes: 32,
    });
  });

  it("converts an oversized image to a smaller WebP in the browser", async () => {
    const close = vi.fn();
    const drawImage = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ clearRect: vi.fn(), drawImage })),
      toBlob: vi.fn((callback: BlobCallback) =>
        callback(new Blob([new Uint8Array(800_000)], { type: "image/webp" })),
      ),
    } as unknown as HTMLCanvasElement;
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ width: 4_000, height: 3_000, close })),
    );
    vi.stubGlobal("document", {
      createElement: vi.fn(() => canvas),
    });
    const file = new File([new Uint8Array(5_000_001)], "reference.png", {
      type: "image/png",
    });

    const result = await compressReferenceImage(file);

    expect(result.compressed).toBe(true);
    expect(result.originalBytes).toBe(5_000_001);
    expect(result.file.name).toBe("reference-compressed.webp");
    expect(result.file.type).toBe("image/webp");
    expect(result.file.size).toBe(800_000);
    expect(canvas.width).toBe(2_560);
    expect(canvas.height).toBe(1_920);
    expect(drawImage).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });
});
