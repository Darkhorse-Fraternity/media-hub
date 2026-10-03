import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import type { MediaVideoScriptShot } from "@acme/db/schema";

import { renderScriptAnimatic, renderScriptCut } from "./video-script-render";

const execFileAsync = promisify(execFile);

const shot: MediaVideoScriptShot = {
  id: "one",
  title: "测试",
  durationSeconds: 3,
  visualDescription: "A color frame",
  cameraDirection: "",
  continuity: "",
  soundscape: "",
  music: "N/A",
  dialogues: [],
  trimStartSeconds: 1,
  trimEndSeconds: 2,
  captions: [
    { id: "caption", startSeconds: 0.5, endSeconds: 2.5, text: "字幕测试" },
  ],
};

describe("video script rendering", () => {
  it("renders a trimmed captioned cut and a still-frame animatic", async () => {
    const directory = await mkdtemp(join(tmpdir(), "script-render-test-"));
    try {
      const sourcePath = join(directory, "source.mp4");
      const framePath = join(directory, "frame.png");
      await execFileAsync("ffmpeg", [
        "-f",
        "lavfi",
        "-i",
        "color=c=blue:s=160x90:r=24",
        "-f",
        "lavfi",
        "-i",
        "anullsrc=r=48000:cl=stereo",
        "-t",
        "3",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-shortest",
        "-y",
        "-loglevel",
        "error",
        sourcePath,
      ]);
      await execFileAsync("ffmpeg", [
        "-f",
        "lavfi",
        "-i",
        "color=c=red:s=160x90",
        "-frames:v",
        "1",
        "-y",
        "-loglevel",
        "error",
        framePath,
      ]);
      const cut = await renderScriptCut(
        [await readFile(sourcePath)],
        [shot],
        true,
      );
      const animatic = await renderScriptAnimatic(
        [await readFile(framePath)],
        [shot],
        160,
        90,
      );
      expect(cut.byteLength).toBeGreaterThan(1000);
      expect(animatic.byteLength).toBeGreaterThan(1000);
      const outputPath = join(directory, "cut.mp4");
      await writeFile(outputPath, cut);
      const { stdout } = await execFileAsync("ffprobe", [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        outputPath,
      ]);
      expect(Number(stdout.trim())).toBeGreaterThan(0.9);
      expect(Number(stdout.trim())).toBeLessThan(1.2);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
});
