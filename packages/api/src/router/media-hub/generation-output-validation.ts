import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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
        { maxBuffer: 2_000_000 },
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
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
