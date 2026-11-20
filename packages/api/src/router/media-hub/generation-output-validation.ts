import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SAMPLE_WIDTH = 176;
const SAMPLE_HEIGHT = 100;
const SAMPLE_COUNT = 5;
const SAMPLE_PIXELS = SAMPLE_WIDTH * SAMPLE_HEIGHT;
const SAMPLE_BYTES = SAMPLE_PIXELS * 3;

interface ProbeStream {
  codec_name?: string;
  codec_type?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  sample_rate?: string;
  channels?: number;
  duration?: string;
}

export interface GenerationMediaProbe {
  streams?: ProbeStream[];
  format?: { duration?: string };
}

export interface ExpectedGenerationMedia {
  durationSeconds: number;
  width: number;
  height: number;
  fps: number;
}

export class GenerationOutputValidationError extends Error {
  readonly code = "output_validation_failed";
  readonly failureStage = "output_validation";
  readonly retryable = true;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "GenerationOutputValidationError";
  }
}

function finiteNumber(value: string | number | undefined): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function frameRate(value: string | undefined): number | null {
  if (!value) return null;
  const [numerator, denominator = "1"] = value.split("/");
  const top = finiteNumber(numerator);
  const bottom = finiteNumber(denominator);
  if (top === null || bottom === null || bottom === 0) return null;
  return top / bottom;
}

export function generationMediaProbeIssues(
  probe: GenerationMediaProbe,
  expected: ExpectedGenerationMedia,
): string[] {
  const issues: string[] = [];
  const streams = probe.streams ?? [];
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");
  if (!video) return ["生成文件缺少视频轨"];
  if (video.codec_name !== "h264") {
    issues.push(`视频编码应为 H.264，实际为 ${video.codec_name ?? "unknown"}`);
  }
  if (video.width !== expected.width || video.height !== expected.height) {
    issues.push(
      `视频分辨率应为 ${expected.width}×${expected.height}，实际为 ${video.width ?? "?"}×${video.height ?? "?"}`,
    );
  }
  const actualFps =
    frameRate(video.avg_frame_rate) ?? frameRate(video.r_frame_rate);
  if (actualFps === null || Math.abs(actualFps - expected.fps) > 0.05) {
    issues.push(
      `视频帧率应为 ${expected.fps} FPS，实际为 ${actualFps?.toFixed(3) ?? "unknown"}`,
    );
  }
  const duration =
    finiteNumber(probe.format?.duration) ?? finiteNumber(video.duration);
  const durationTolerance = Math.max(1, expected.durationSeconds * 0.03);
  if (
    duration === null ||
    Math.abs(duration - expected.durationSeconds) > durationTolerance
  ) {
    issues.push(
      `视频时长应约为 ${expected.durationSeconds} 秒，实际为 ${duration?.toFixed(3) ?? "unknown"} 秒`,
    );
  }
  if (!audio) {
    issues.push("H3 原生成片缺少音频轨");
  } else {
    if (audio.codec_name !== "aac") {
      issues.push(`音频编码应为 AAC，实际为 ${audio.codec_name ?? "unknown"}`);
    }
    const sampleRate = finiteNumber(audio.sample_rate);
    if (sampleRate === null || sampleRate < 16_000) {
      issues.push(
        `音频采样率过低或不可识别：${audio.sample_rate ?? "unknown"}`,
      );
    }
    if (!audio.channels || audio.channels < 1) {
      issues.push("音频声道不可识别");
    }
  }
  return issues;
}

// Check for the low-contrast, nearly colorless texture seen in failed H3 renders.
// A frame with visible edges or chroma is allowed even in a mostly dark shot.
function hasNoVisibleDetail(rgb: Buffer): boolean {
  const luma = Buffer.alloc(SAMPLE_PIXELS);
  const edgeCount = 2 * SAMPLE_PIXELS - SAMPLE_WIDTH - SAMPLE_HEIGHT;
  let sum = 0;
  let squares = 0;
  let distinctEdges = 0;
  let colorfulPixels = 0;
  for (let pixel = 0; pixel < SAMPLE_PIXELS; pixel++) {
    const offset = pixel * 3;
    const red = rgb.readUInt8(offset);
    const green = rgb.readUInt8(offset + 1);
    const blue = rgb.readUInt8(offset + 2);
    const value = (77 * red + 150 * green + 29 * blue) >> 8;
    luma[pixel] = value;
    sum += value;
    squares += value * value;
    if (Math.max(red, green, blue) - Math.min(red, green, blue) >= 24) {
      colorfulPixels++;
    }
    if (
      pixel % SAMPLE_WIDTH > 0 &&
      Math.abs(value - luma.readUInt8(pixel - 1)) >= 12
    ) {
      distinctEdges++;
    }
    if (
      pixel >= SAMPLE_WIDTH &&
      Math.abs(value - luma.readUInt8(pixel - SAMPLE_WIDTH)) >= 12
    ) {
      distinctEdges++;
    }
  }
  const variance = squares / SAMPLE_PIXELS - (sum / SAMPLE_PIXELS) ** 2;
  return (
    variance <= 8 ** 2 &&
    distinctEdges / edgeCount <= 0.002 &&
    colorfulPixels / SAMPLE_PIXELS <= 0.002
  );
}

export async function validateGeneratedVideoPicture(
  inputPath: string,
  durationSeconds: number,
): Promise<void> {
  let samples: Buffer;
  try {
    ({ stdout: samples } = await execFileAsync(
      process.env.FFMPEG_PATH ?? "ffmpeg",
      [
        "-nostdin",
        "-v",
        "error",
        "-xerror",
        "-threads",
        "1",
        "-filter_threads",
        "1",
        "-i",
        inputPath,
        "-map",
        "0:v:0",
        "-vf",
        `fps=${SAMPLE_COUNT}/${durationSeconds},scale=${SAMPLE_WIDTH}:${SAMPLE_HEIGHT}:flags=area`,
        "-pix_fmt",
        "rgb24",
        "-threads",
        "1",
        "-frames:v",
        String(SAMPLE_COUNT),
        "-f",
        "rawvideo",
        "pipe:1",
      ],
      {
        encoding: "buffer",
        maxBuffer: SAMPLE_COUNT * SAMPLE_BYTES,
        timeout: 30_000,
      },
    ));
  } catch (error) {
    throw new GenerationOutputValidationError("无法抽取成片画面进行验收", {
      cause: error,
    });
  }
  if (samples.length < 3 * SAMPLE_BYTES || samples.length % SAMPLE_BYTES) {
    throw new GenerationOutputValidationError("成片可解码的画面不足");
  }
  for (let start = 0; start < samples.length; start += SAMPLE_BYTES) {
    if (!hasNoVisibleDetail(samples.subarray(start, start + SAMPLE_BYTES))) {
      return;
    }
  }
  throw new GenerationOutputValidationError(
    "成片抽查画面均为空白或低对比度灰纹，没有可辨认画面",
  );
}

export async function validateGeneratedVideoOutput(
  video: Buffer,
  expected: ExpectedGenerationMedia,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "media-hub-output-validation-"));
  const inputPath = join(dir, "generated.mp4");
  try {
    await writeFile(inputPath, video);
    let stdout: string;
    try {
      ({ stdout } = await execFileAsync(
        process.env.FFPROBE_PATH ?? "ffprobe",
        [
          "-v",
          "error",
          "-show_streams",
          "-show_format",
          "-of",
          "json",
          inputPath,
        ],
        { maxBuffer: 2_000_000, timeout: 30_000 },
      ));
    } catch (error) {
      throw new GenerationOutputValidationError(
        "生成文件无法通过 ffprobe 解析",
        { cause: error },
      );
    }
    let probe: GenerationMediaProbe;
    try {
      probe = JSON.parse(stdout) as GenerationMediaProbe;
    } catch (error) {
      throw new GenerationOutputValidationError("ffprobe 返回了无效 JSON", {
        cause: error,
      });
    }
    const issues = generationMediaProbeIssues(probe, expected);
    if (issues.length) {
      throw new GenerationOutputValidationError(issues.join("；"));
    }
    const videoStream = probe.streams?.find(
      (stream) => stream.codec_type === "video",
    );
    const duration = finiteNumber(videoStream?.duration);
    await validateGeneratedVideoPicture(
      inputPath,
      duration && duration > 0 ? duration : expected.durationSeconds,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
