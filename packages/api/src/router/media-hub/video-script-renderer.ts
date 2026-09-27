import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const TRANSITION_SECONDS = 0.3;

export type VideoScriptTransition = "cut" | "fade_white" | "fade_black";

async function concatShotVideos(videos: Buffer[]): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "media-hub-script-assembly-"));
  try {
    const listPath = join(dir, "concat.txt");
    const outputPath = join(dir, "assembled.mp4");
    const lines: string[] = [];
    for (const [index, video] of videos.entries()) {
      const inputPath = join(dir, `shot-${index + 1}.mp4`);
      await writeFile(inputPath, video);
      lines.push(`file '${inputPath}'`);
    }
    await writeFile(listPath, `${lines.join("\n")}\n`);
    await execFileAsync(process.env.FFMPEG_PATH ?? "ffmpeg", [
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
      "-y",
      "-loglevel",
      "error",
    ]);
    return await readFile(outputPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function probeShot(path: string): Promise<{
  duration: number;
  hasAudio: boolean;
}> {
  const { stdout } = await execFileAsync(
    process.env.FFPROBE_PATH ?? "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_type,duration:format=duration",
      "-of",
      "json",
      path,
    ],
  );
  const probe = JSON.parse(stdout) as {
    streams?: { codec_type?: string; duration?: string }[];
    format?: { duration?: string };
  };
  const video = probe.streams?.find((stream) => stream.codec_type === "video");
  const duration = Number(video?.duration ?? probe.format?.duration);
  if (!video || !Number.isFinite(duration) || duration <= TRANSITION_SECONDS) {
    throw new Error("镜头视频时长或视频流无效，无法生成转场");
  }
  return {
    duration,
    hasAudio: Boolean(
      probe.streams?.some((stream) => stream.codec_type === "audio"),
    ),
  };
}

export async function renderShotVideos(
  videos: Buffer[],
  transition: VideoScriptTransition,
  fps: number,
): Promise<Buffer> {
  if (transition === "cut" || videos.length < 2) {
    return concatShotVideos(videos);
  }
  const dir = await mkdtemp(join(tmpdir(), "media-hub-script-transition-"));
  try {
    const paths = await Promise.all(
      videos.map(async (video, index) => {
        const path = join(dir, `shot-${index + 1}.mp4`);
        await writeFile(path, video);
        return path;
      }),
    );
    const probes = await Promise.all(paths.map(probeShot));
    const filters: string[] = [];
    for (const [index, shot] of probes.entries()) {
      const duration = shot.duration.toFixed(6);
      filters.push(
        `[${index}:v]fps=${fps},format=yuv420p,settb=AVTB,setpts=PTS-STARTPTS[v${index}]`,
      );
      filters.push(
        shot.hasAudio
          ? `[${index}:a]aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,apad,atrim=duration=${duration},asetpts=PTS-STARTPTS[a${index}]`
          : `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=${duration},asetpts=PTS-STARTPTS[a${index}]`,
      );
    }
    let elapsed = probes[0]!.duration;
    let videoLabel = "v0";
    let audioLabel = "a0";
    const effect = transition === "fade_white" ? "fadewhite" : "fadeblack";
    for (let index = 1; index < paths.length; index++) {
      const nextVideo = `vx${index}`;
      const nextAudio = `ax${index}`;
      filters.push(
        `[${videoLabel}][v${index}]xfade=transition=${effect}:duration=${TRANSITION_SECONDS}:offset=${(elapsed - TRANSITION_SECONDS).toFixed(6)}[${nextVideo}]`,
      );
      filters.push(
        `[${audioLabel}][a${index}]acrossfade=d=${TRANSITION_SECONDS}:c1=tri:c2=tri[${nextAudio}]`,
      );
      elapsed += probes[index]!.duration - TRANSITION_SECONDS;
      videoLabel = nextVideo;
      audioLabel = nextAudio;
    }
    const outputPath = join(dir, "assembled.mp4");
    await execFileAsync(process.env.FFMPEG_PATH ?? "ffmpeg", [
      ...paths.flatMap((path) => ["-i", path]),
      "-filter_complex",
      filters.join(";"),
      "-map",
      `[${videoLabel}]`,
      "-map",
      `[${audioLabel}]`,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "20",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-movflags",
      "+faststart",
      "-shortest",
      outputPath,
      "-y",
      "-loglevel",
      "error",
    ]);
    return await readFile(outputPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
