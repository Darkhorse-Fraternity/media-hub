import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { TRPCError } from "@trpc/server";

import type { MediaGenerationReferenceVideo } from "@acme/db/schema";
import { getMediaHubObject } from "@acme/storage";
import { MEDIA_H3_REFERENCE_VIDEO_MAX_BYTES } from "@acme/validators";

const execFileAsync = promisify(execFile);

export class H3ReferenceVideoChangedError extends Error {
  readonly code = "reference_video_changed";
  readonly failureStage = "input_validation";
  readonly retryable = false;

  constructor() {
    super("参考视频在提交后发生变化，请重新创建任务");
  }
}

export async function loadVerifiedH3ReferenceVideo(
  reference: MediaGenerationReferenceVideo,
): Promise<Buffer> {
  const content = await getMediaHubObject(
    reference.storageKey,
    undefined,
    MEDIA_H3_REFERENCE_VIDEO_MAX_BYTES,
  );
  if (
    `sha256:${createHash("sha256").update(content).digest("hex")}` !==
    reference.checksum
  ) {
    throw new H3ReferenceVideoChangedError();
  }
  return content;
}

export function h3ReferenceFrameCount(durationSeconds: number): number {
  return Math.min(
    362,
    Math.max(
      56,
      Math.ceil((Math.ceil(durationSeconds * 24) - 5) / 17) * 17 + 5,
    ),
  );
}

interface ReferenceProbe {
  streams?: {
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
    avg_frame_rate?: string;
    nb_read_frames?: string;
    duration?: string;
  }[];
  format?: { duration?: string };
}

export function referenceVideoProbeMetadata(
  probe: ReferenceProbe,
  expected: { width: number; height: number; durationSeconds: number },
): Omit<
  MediaGenerationReferenceVideo,
  "storageKey" | "name" | "contentType" | "checksum"
> {
  const video = probe.streams?.find((stream) => stream.codec_type === "video");
  const [numerator, denominator = "1"] = (video?.avg_frame_rate ?? "").split(
    "/",
  );
  const fps = Number(numerator) / Number(denominator);
  const frameCount = Number(video?.nb_read_frames);
  const durationSeconds = Number(video?.duration ?? probe.format?.duration);
  const width = video?.width ?? 0;
  const height = video?.height ?? 0;
  if (
    video?.codec_name !== "h264" ||
    !Number.isFinite(fps) ||
    Math.abs(fps - 24) > 0.001 ||
    frameCount !== h3ReferenceFrameCount(expected.durationSeconds) ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds < 2 ||
    durationSeconds > 15.1 ||
    Math.abs(durationSeconds - frameCount / 24) > 1 / 24 ||
    width < 64 ||
    height < 64 ||
    width > 1344 ||
    height > 1344 ||
    Math.abs(width / height - expected.width / expected.height) > 0.005
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `参考视频必须为 H.264 MP4、24 FPS、${h3ReferenceFrameCount(expected.durationSeconds)} 帧，宽高各 64–1344 且画幅与输出一致；请先规范化白模预演`,
    });
  }
  return { width, height, fps, frameCount, durationSeconds };
}

export function assertReferenceStorageOwner(
  key: string,
  ownerId: string,
  kind: "video" | "cover",
): void {
  const prefix = `media-hub/${kind}/${ownerId}/`;
  if (
    !key.startsWith(prefix) ||
    !/^[a-zA-Z0-9-]+\.[a-zA-Z0-9]+$/.test(key.slice(prefix.length))
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "参考素材必须由当前用户通过上传接口上传",
    });
  }
}

export async function inspectH3ReferenceVideo(
  input: { storageKey: string; name: string; contentType: "video/mp4" },
  ownerId: string,
  expected: { width: number; height: number; durationSeconds: number },
): Promise<MediaGenerationReferenceVideo> {
  assertReferenceStorageOwner(input.storageKey, ownerId, "video");
  return inspectStoredH3ReferenceVideo(input, expected);
}

/** Internal: the caller must establish ownership before passing a stored artifact. */
export async function inspectStoredH3ReferenceVideo(
  input: { storageKey: string; name: string; contentType: "video/mp4" },
  expected: { width: number; height: number; durationSeconds: number },
): Promise<MediaGenerationReferenceVideo> {
  let content: Buffer;
  try {
    content = await getMediaHubObject(
      input.storageKey,
      undefined,
      MEDIA_H3_REFERENCE_VIDEO_MAX_BYTES,
    );
  } catch (error) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "参考视频未上传、不可读取或超过 50 MB",
      cause: error,
    });
  }
  const dir = await mkdtemp(join(tmpdir(), "media-hub-previs-"));
  try {
    const path = join(dir, "reference.mp4");
    await writeFile(path, content);
    let probe: ReferenceProbe;
    try {
      const { stdout } = await execFileAsync(
        process.env.FFPROBE_PATH ?? "ffprobe",
        [
          "-v",
          "error",
          "-protocol_whitelist",
          "file,pipe",
          "-count_frames",
          "-show_streams",
          "-show_format",
          "-of",
          "json",
          path,
        ],
        { timeout: 30_000, maxBuffer: 2_000_000 },
      );
      probe = JSON.parse(stdout) as ReferenceProbe;
    } catch (error) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "参考视频无法通过 ffprobe 解析",
        cause: error,
      });
    }
    return {
      ...input,
      ...referenceVideoProbeMetadata(probe, expected),
      checksum: `sha256:${createHash("sha256").update(content).digest("hex")}`,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
