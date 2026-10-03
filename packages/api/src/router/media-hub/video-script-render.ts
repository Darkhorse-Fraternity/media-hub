import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type { MediaVideoScriptShot } from "@acme/db/schema";

import { captionsToSrt, shotTrim } from "./video-script-edit-plan";

const execFileAsync = promisify(execFile);

async function ffmpeg(args: string[]) {
  await execFileAsync(process.env.FFMPEG_PATH ?? "ffmpeg", [
    ...args,
    "-y",
    "-loglevel",
    "error",
  ]);
}

async function concatFiles(paths: string[], directory: string) {
  const listPath = join(directory, "concat.txt");
  const outputPath = join(directory, "joined.mp4");
  await writeFile(
    listPath,
    `${paths.map((path) => `file '${path}'`).join("\n")}\n`,
  );
  await ffmpeg([
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listPath,
    "-c",
    "copy",
    "-movflags",
    "+faststart",
    outputPath,
  ]);
  return outputPath;
}

export async function renderScriptCut(
  videos: Buffer[],
  shots: MediaVideoScriptShot[],
  burnCaptions: boolean,
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
      await writeFile(inputPath, video);
      const trim = shotTrim(shot);
      if (!requiresTranscode) {
        paths.push(inputPath);
        continue;
      }
      const trimmedPath = join(dir, `trimmed-${index}.mp4`);
      await ffmpeg([
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
      ]);
      paths.push(trimmedPath);
    }
    const joinedPath = await concatFiles(paths, dir);
    if (!burnCaptions) return await readFile(joinedPath);
    const srt = captionsToSrt(shots);
    if (!srt.trim()) throw new Error("没有可输出的字幕，请先生成或填写字幕");
    const srtPath = join(dir, "captions.srt");
    const captionedPath = join(dir, "captioned.mp4");
    await writeFile(srtPath, srt);
    await ffmpeg([
      "-i",
      joinedPath,
      "-vf",
      `subtitles=${srtPath}`,
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
    ]);
    return await readFile(captionedPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function renderScriptAnimatic(
  images: Buffer[],
  shots: MediaVideoScriptShot[],
  width: number,
  height: number,
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
      await writeFile(inputPath, image);
      await ffmpeg([
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
      ]);
      paths.push(outputPath);
    }
    return await readFile(await concatFiles(paths, dir));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
