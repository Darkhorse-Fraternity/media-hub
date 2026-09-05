import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function extractMediaGenerationLastFrame(
  video: Buffer,
): Promise<Buffer> {
  const directory = await mkdtemp(join(tmpdir(), "media-hub-h3-frame-"));
  try {
    const inputPath = join(directory, "segment.mp4");
    const outputPath = join(directory, "last-frame.png");
    await writeFile(inputPath, video);
    await execFileAsync(process.env.FFMPEG_PATH ?? "ffmpeg", [
      "-sseof",
      "-0.1",
      "-i",
      inputPath,
      "-frames:v",
      "1",
      "-f",
      "image2",
      outputPath,
      "-y",
      "-loglevel",
      "error",
    ]);
    return await readFile(outputPath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
