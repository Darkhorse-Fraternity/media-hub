import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import {
  extractH3AVContext,
  H3_AV_CONTEXT_SECONDS,
  trimH3AVContinuation,
} from "./h3-native-continuation";
import { renderScriptCut } from "./video-script-render";

const execute = promisify(execFile);
const ffmpeg = process.env.FFMPEG_PATH ?? "ffmpeg";

describe("H3 native AV media path", () => {
  it("keeps synchronized audio and motion, removes the prefix and trims default H3 tails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "h3-av-test-"));
    try {
      const source = join(dir, "source.mp4");
      await execute(ffmpeg, [
        "-f",
        "lavfi",
        "-i",
        "color=red:s=96x64:r=24:d=1",
        "-f",
        "lavfi",
        "-i",
        "color=blue:s=96x64:r=24:d=2",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=48000:duration=3",
        "-filter_complex",
        "[0:v][1:v]concat=n=2:v=1:a=0[v]",
        "-map",
        "[v]",
        "-map",
        "2:a",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-y",
        "-loglevel",
        "error",
        source,
      ]);
      const content = await readFile(source);
      const context = await extractH3AVContext(content);
      const next = await trimH3AVContinuation(content, 1.5);
      async function decoded(name: string, video: Buffer) {
        const path = join(dir, name);
        await writeFile(path, video);
        const audio = await execute(
          ffmpeg,
          [
            "-i",
            path,
            "-map",
            "0:a:0",
            "-ac",
            "1",
            "-ar",
            "48000",
            "-f",
            "s16le",
            "-loglevel",
            "error",
            "pipe:1",
          ],
          { encoding: "buffer" },
        );
        return { path, seconds: audio.stdout.byteLength / (48000 * 2) };
      }
      const ctx = await decoded("context.mp4", context);
      expect(ctx.seconds).toBeCloseTo(H3_AV_CONTEXT_SECONDS, 1);
      const authoredEnd = await decoded(
        "authored-context.mp4",
        await extractH3AVContext(content, 1),
      );
      const authoredPixels = await execute(
        ffmpeg,
        [
          "-i",
          authoredEnd.path,
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
      expect(authoredPixels.stdout[0]).toBeGreaterThan(200);
      expect(authoredPixels.stdout[2]).toBeLessThan(30);
      await expect(extractH3AVContext(content, 0.1)).rejects.toThrow(
        "结束点无效",
      );
      const trimmed = await decoded("next.mp4", next);
      expect(trimmed.seconds).toBeGreaterThan(1.45);
      expect(trimmed.seconds).toBeLessThan(1.55);
      const pixels = await execute(
        ffmpeg,
        [
          "-ss",
          "0.25",
          "-i",
          trimmed.path,
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
      expect(pixels.stdout[2]).toBeGreaterThan(200);
      expect(pixels.stdout[0]).toBeLessThan(30);
      const shot = {
        id: "a",
        title: "a",
        durationSeconds: 2,
        visualDescription: "A color",
        cameraDirection: "",
        continuity: "",
        soundscape: "",
        music: "N/A",
        dialogues: [],
      };
      const cut = await renderScriptCut(
        [content, content],
        [shot, { ...shot, id: "b" }],
        false,
      );
      const assembled = await decoded("assembled.mp4", cut);
      expect(assembled.seconds).toBeGreaterThan(3.95);
      expect(assembled.seconds).toBeLessThan(4.1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
