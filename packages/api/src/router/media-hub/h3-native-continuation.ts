import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { MEDIA_H3_SCRIPT_SHOT_SECONDS } from "@acme/validators";

import { H3_FPS, H3_I2VA_ALIGNMENT } from "./h3-generation-config";

export const H3_AV_CONTEXT_FRAMES = 22;
export const H3_AV_CONTEXT_SECONDS = H3_AV_CONTEXT_FRAMES / 24;
export const H3_AV_MAX_SHOT_SECONDS = MEDIA_H3_SCRIPT_SHOT_SECONDS;
// A 15-second authored shot plus its 22-frame prefix needs 396 frames on H3's
// 17k+5 grid. The prefix is removed from both streams before the shot is saved.
export const H3_AV_MAX_RENDER_FRAMES =
  Math.ceil((H3_AV_MAX_SHOT_SECONDS * H3_FPS + H3_AV_CONTEXT_FRAMES - 5) / 17) *
    17 +
  5;

export function h3NativeContinuationFrameCount(
  durationSeconds: number,
): number {
  if (
    !Number.isFinite(durationSeconds) ||
    durationSeconds < 5 ||
    durationSeconds > H3_AV_MAX_SHOT_SECONDS
  ) {
    throw new Error(
      `原生音视频延续镜头需在 5–${H3_AV_MAX_SHOT_SECONDS} 秒之间`,
    );
  }
  const requestedFrames =
    Math.ceil(durationSeconds * H3_FPS) + H3_AV_CONTEXT_FRAMES;
  return Math.ceil((requestedFrames - 5) / 17) * 17 + 5;
}

const execFileAsync = promisify(execFile);

/** Use a synchronized tail, rather than a still image, to condition both H3 streams. */
export async function extractH3AVContext(
  video: Buffer,
  endSeconds?: number,
): Promise<Buffer> {
  if (
    endSeconds !== undefined &&
    (!Number.isFinite(endSeconds) || endSeconds < H3_AV_CONTEXT_SECONDS)
  ) {
    throw new Error("原生音视频上下文结束点无效");
  }
  const position =
    endSeconds === undefined
      ? ["-sseof", String(-H3_AV_CONTEXT_SECONDS)]
      : ["-ss", String(endSeconds - H3_AV_CONTEXT_SECONDS)];
  return transform(video, position, ["-t", String(H3_AV_CONTEXT_SECONDS)]);
}

/** Remove the generated context prefix from both streams before assembly/ASR. */
export async function trimH3AVContinuation(
  video: Buffer,
  duration: number,
): Promise<Buffer> {
  return transform(
    video,
    ["-ss", String(H3_AV_CONTEXT_SECONDS)],
    ["-t", String(duration)],
  );
}

async function transform(
  video: Buffer,
  beforeInput: string[],
  afterInput: string[],
): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "media-hub-h3-av-"));
  try {
    const input = join(dir, "source.mp4");
    const output = join(dir, "context.mp4");
    await writeFile(input, video);
    await execFileAsync(
      process.env.FFMPEG_PATH ?? "ffmpeg",
      [
        ...beforeInput,
        "-i",
        input,
        ...afterInput,
        "-map",
        "0:v:0",
        "-map",
        "0:a:0",
        "-r",
        "24",
        "-fps_mode",
        "cfr",
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-ar",
        "48000",
        "-movflags",
        "+faststart",
        "-y",
        "-loglevel",
        "error",
        output,
      ],
      { timeout: 120_000, maxBuffer: 2_000_000 },
    );
    return await readFile(output);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function h3ContinuationPrompt(prompt: string): string {
  // Shift structured dialogue timestamps. The authored visual timeline remains
  // relative to the new scene, explicitly distinguished from its context prefix.
  const shifted = prompt
    .replace(H3_I2VA_ALIGNMENT, "")
    .trim()
    .replace(
      /At (\d{2}):(\d{2})\.(\d{3})(?=, (?:Voice direction:|Off-screen voiceover;|\(S[1-4]\) <d>))/g,
      (_, minutes: string, seconds: string, millis: string) => {
        const time =
          Number(minutes) * 60 +
          Number(seconds) +
          Number(millis) / 1000 +
          H3_AV_CONTEXT_SECONDS;
        const ms = Math.round(time * 1000);
        return `At ${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
      },
    );
  return `The first ${H3_AV_CONTEXT_SECONDS.toFixed(6)} seconds are synchronized video and audio context from the previous shot. Continue the same audible speakers, voice timbre, delivery, ambience and physical motion. Do not repeat the context's words. The new scene begins after that prefix; visual action times below are relative to the new scene. Dialogue timestamps below already include the prefix.\n${shifted}`;
}
