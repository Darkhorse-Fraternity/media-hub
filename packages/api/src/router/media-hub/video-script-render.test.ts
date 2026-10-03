import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import type { MediaVideoScriptShot } from "@acme/db/schema";

import { renderScriptAnimatic, renderScriptCut } from "./video-script-render";

const execFileAsync = promisify(execFile);
const ffmpegPath = process.env.FFMPEG_PATH ?? "ffmpeg";
const ffprobePath = process.env.FFPROBE_PATH ?? "ffprobe";

async function pixels(file: string, seconds = 0.5) {
  const { stdout } = await execFileAsync(
    ffmpegPath,
    [
      "-ss",
      String(seconds),
      "-i",
      file,
      "-frames:v",
      "1",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "-loglevel",
      "error",
      "pipe:1",
    ],
    { encoding: "buffer" },
  );
  return stdout;
}

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
      await execFileAsync(ffmpegPath, [
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
      await execFileAsync(ffmpegPath, [
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
      const plain = await renderScriptCut(
        [await readFile(sourcePath)],
        [shot],
        false,
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
      const { stdout } = await execFileAsync(ffprobePath, [
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
      const plainPath = join(directory, "plain.mp4");
      const previewPath = join(directory, "preview.mp4");
      await writeFile(plainPath, plain);
      await writeFile(previewPath, animatic);
      const [captionPixels, plainPixels, previewPixels] = await Promise.all([
        pixels(outputPath),
        pixels(plainPath),
        pixels(previewPath),
      ]);
      let differences = 0;
      for (let index = 0; index < captionPixels.length; index += 3) {
        if (
          Math.abs((captionPixels[index] ?? 0) - (plainPixels[index] ?? 0)) +
            Math.abs(
              (captionPixels[index + 1] ?? 0) - (plainPixels[index + 1] ?? 0),
            ) +
            Math.abs(
              (captionPixels[index + 2] ?? 0) - (plainPixels[index + 2] ?? 0),
            ) >
          60
        )
          differences++;
      }
      expect(differences).toBeGreaterThan(30);
      expect(previewPixels[0]).toBeGreaterThan(200);
      expect(previewPixels[2]).toBeLessThan(30);
      const combined = await renderScriptCut(
        [plain, animatic],
        [
          shot,
          { ...shot, id: "two", trimStartSeconds: 0, trimEndSeconds: 1 },
        ].map((item) => ({
          ...item,
          durationSeconds: 1,
          trimStartSeconds: 0,
          trimEndSeconds: 1,
        })),
        false,
        undefined,
        { width: 320, height: 180 },
      );
      const combinedPath = join(directory, "combined.mp4");
      await writeFile(combinedPath, combined);
      const [bluePixels, redPixels] = await Promise.all([
        pixels(combinedPath, 0.3),
        pixels(combinedPath, 1.3),
      ]);
      expect(bluePixels[2]).toBeGreaterThan(200);
      expect(bluePixels[0]).toBeLessThan(30);
      expect(redPixels[0]).toBeGreaterThan(200);
      expect(redPixels[2]).toBeLessThan(30);
      const metadata = JSON.parse(
        (
          await execFileAsync(ffprobePath, [
            "-v",
            "error",
            "-show_streams",
            "-show_format",
            "-of",
            "json",
            combinedPath,
          ])
        ).stdout,
      ) as {
        streams: {
          codec_type: string;
          width?: number;
          height?: number;
          r_frame_rate?: string;
        }[];
        format: { duration: string };
      };
      expect(metadata.streams).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ codec_type: "audio" }),
          expect.objectContaining({
            codec_type: "video",
            width: 320,
            height: 180,
            r_frame_rate: "24/1",
          }),
        ]),
      );
      expect(Number(metadata.format.duration)).toBeGreaterThan(1.9);
      expect(Number(metadata.format.duration)).toBeLessThan(2.2);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
  it("rejects inconsistent input and canceled work before fetching sources", async () => {
    await expect(renderScriptCut([], [shot], false)).rejects.toThrow(
      "镜头视频数量",
    );
    await expect(renderScriptAnimatic([], [shot], 160, 90)).rejects.toThrow(
      "首帧数量",
    );
    let fetched = false;
    const source = () => {
      fetched = true;
      return Promise.resolve(Buffer.from("unused"));
    };
    await expect(
      renderScriptCut(
        [source],
        [shot],
        false,
        AbortSignal.abort(new Error("stopped")),
      ),
    ).rejects.toThrow("stopped");
    expect(fetched).toBe(false);
  });
});
