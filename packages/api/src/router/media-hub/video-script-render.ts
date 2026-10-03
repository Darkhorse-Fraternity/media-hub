import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";

import type { MediaVideoScriptShot } from "@acme/db/schema";

import { captionsToSrt, shotTrim } from "./video-script-edit-plan";

const execFileAsync = promisify(execFile);

export type ScriptRenderInput = Buffer | (() => Promise<Buffer>);

async function resolveInput(input: ScriptRenderInput, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const data = typeof input === "function" ? await input() : input;
  signal?.throwIfAborted();
  return data;
}

async function ffmpeg(args: string[], directory: string, signal?: AbortSignal) {
  await execFileAsync(
    process.env.FFMPEG_PATH ?? "ffmpeg",
    [...args, "-y", "-loglevel", "error"],
    { cwd: directory, signal, timeout: 120_000, maxBuffer: 2_000_000 },
  );
}

async function concatFiles(
  paths: string[],
  directory: string,
  signal?: AbortSignal,
  dimensions?: { width: number; height: number },
) {
  const listPath = join(directory, "concat.txt");
  const outputPath = join(directory, "joined.mp4");
  await writeFile(
    listPath,
    `${paths.map((path) => `file '${basename(path)}'`).join("\n")}\n`,
  );
  await ffmpeg(
    [
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listPath,
      ...(dimensions
        ? [
            "-vf",
            `scale=${dimensions.width}:${dimensions.height}:force_original_aspect_ratio=decrease,pad=${dimensions.width}:${dimensions.height}:(ow-iw)/2:(oh-ih)/2`,
          ]
        : []),
      "-r",
      "24",
      "-fps_mode",
      "cfr",
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "20",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-ar",
      "48000",
      "-movflags",
      "+faststart",
      outputPath,
    ],
    directory,
    signal,
  );
  return outputPath;
}

export async function renderScriptCut(
  videos: ScriptRenderInput[],
  shots: MediaVideoScriptShot[],
  burnCaptions: boolean,
  signal?: AbortSignal,
  dimensions?: { width: number; height: number },
): Promise<Buffer> {
  if (videos.length !== shots.length || videos.length === 0) {
    throw new Error("镜头视频数量与脚本不一致");
  }
  const dir = await mkdtemp(join(tmpdir(), "media-hub-script-cut-"));
  try {
    const paths: string[] = [];
    const requiresTranscode = shots.some((shot) => {
      const trim = shotTrim(shot);
      return trim.start !== 0 || trim.end !== shot.durationSeconds;
    });
    for (const [index, video] of videos.entries()) {
      const shot = shots[index];
      if (!shot) throw new Error("镜头不存在");
      const inputPath = join(dir, `source-${index}.mp4`);
      await writeFile(inputPath, await resolveInput(video, signal));
      const trim = shotTrim(shot);
      if (!requiresTranscode) {
        paths.push(inputPath);
        continue;
      }
      const trimmedPath = join(dir, `trimmed-${index}.mp4`);
      await ffmpeg(
        [
          "-ss",
          String(trim.start),
          "-i",
          inputPath,
          "-t",
          String(trim.duration),
          "-map",
          "0:v:0",
          "-map",
          "0:a:0",
          "-c:v",
          "libx264",
          "-preset",
          "fast",
          "-crf",
          "20",
          "-pix_fmt",
          "yuv420p",
          "-c:a",
          "aac",
          "-ar",
          "48000",
          "-movflags",
          "+faststart",
          trimmedPath,
        ],
        dir,
        signal,
      );
      paths.push(trimmedPath);
    }
    const joinedPath = await concatFiles(paths, dir, signal, dimensions);
    if (!burnCaptions) return await readFile(joinedPath);
    const srt = captionsToSrt(shots);
    if (!srt.trim()) throw new Error("没有可输出的字幕，请先生成或填写字幕");
    const srtPath = join(dir, "captions.srt");
    const captionedPath = join(dir, "captioned.mp4");
    await writeFile(srtPath, srt);
    await ffmpeg(
      [
        "-i",
        joinedPath,
        "-vf",
        "subtitles=filename=captions.srt",
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "copy",
        "-movflags",
        "+faststart",
        captionedPath,
      ],
      dir,
      signal,
    );
    return await readFile(captionedPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function renderScriptAnimatic(
  images: ScriptRenderInput[],
  shots: MediaVideoScriptShot[],
  width: number,
  height: number,
  signal?: AbortSignal,
): Promise<Buffer> {
  if (images.length !== shots.length || images.length === 0) {
    throw new Error("首帧数量与镜头不一致");
  }
  const dir = await mkdtemp(join(tmpdir(), "media-hub-animatic-"));
  try {
    const paths: string[] = [];
    for (const [index, image] of images.entries()) {
      const shot = shots[index];
      if (!shot) throw new Error("镜头不存在");
      const inputPath = join(dir, `frame-${index}.png`);
      const outputPath = join(dir, `preview-${index}.mp4`);
      await writeFile(inputPath, await resolveInput(image, signal));
      await ffmpeg(
        [
          "-loop",
          "1",
          "-framerate",
          "24",
          "-i",
          inputPath,
          "-f",
          "lavfi",
          "-i",
          "anullsrc=r=48000:cl=stereo",
          "-t",
          String(shotTrim(shot).duration),
          "-vf",
          `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`,
          "-r",
          "24",
          "-c:v",
          "libx264",
          "-preset",
          "ultrafast",
          "-c:a",
          "aac",
          "-shortest",
          outputPath,
        ],
        dir,
        signal,
      );
      paths.push(outputPath);
    }
    return await readFile(await concatFiles(paths, dir, signal));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
