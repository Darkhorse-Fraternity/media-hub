import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";

import { renderShotVideos } from "./video-script-renderer";

const execFileAsync = promisify(execFile);

it("crossfades two shots and supplies audio when one shot is silent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "media-hub-renderer-test-"));
  try {
    const first = join(dir, "first.mp4");
    const second = join(dir, "second.mp4");
    const result = join(dir, "result.mp4");
    await execFileAsync("ffmpeg", [
      "-f",
      "lavfi",
      "-i",
      "color=c=red:s=64x64:r=24:d=1",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000:duration=1",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-shortest",
      first,
      "-y",
      "-loglevel",
      "error",
    ]);
    await execFileAsync("ffmpeg", [
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=64x64:r=24:d=1",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      second,
      "-y",
      "-loglevel",
      "error",
    ]);
    const video = await renderShotVideos(
      [await readFile(first), await readFile(second)],
      "fade_white",
      24,
    );
    await writeFile(result, video);
    const { stdout } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration:stream=codec_type",
      "-of",
      "json",
      result,
    ]);
    const probe = JSON.parse(stdout) as {
      format: { duration: string };
      streams: { codec_type: string }[];
    };
    expect(Number(probe.format.duration)).toBeGreaterThan(1.5);
    expect(Number(probe.format.duration)).toBeLessThan(1.9);
    expect(probe.streams.map((stream) => stream.codec_type)).toEqual([
      "video",
      "audio",
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
