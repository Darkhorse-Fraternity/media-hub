import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import { extractMediaGenerationLastFrame } from "./video-frame";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("script shot final-frame bridge", () => {
  it("extracts a PNG frame from a successful MP4", async () => {
    const directory = await mkdtemp(join(tmpdir(), "media-hub-frame-test-"));
    temporaryDirectories.push(directory);
    const videoPath = join(directory, "source.mp4");
    await execFileAsync(process.env.FFMPEG_PATH ?? "ffmpeg", [
      "-f",
      "lavfi",
      "-i",
      "color=c=red:s=96x64:d=1",
      "-pix_fmt",
      "yuv420p",
      "-y",
      "-loglevel",
      "error",
      videoPath,
    ]);

    const frame = await extractMediaGenerationLastFrame(
      await readFile(videoPath),
    );

    expect(frame.length).toBeGreaterThan(100);
    expect(frame.subarray(1, 4).toString()).toBe("PNG");
  });
});
