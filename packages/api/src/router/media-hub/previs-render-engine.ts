import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { z } from "zod/v4";

import type { MediaPrevisRenderSpec } from "@acme/db/schema";
import { mediaPrevisRecipeSchema } from "@acme/validators";

import { referenceVideoProbeMetadata } from "./h3-reference-video";

const execFileAsync = promisify(execFile);
const object = z.record(z.string(), z.unknown());
const rpcReply = z.object({
  id: z.number(),
  error: z.unknown().optional(),
  result: z.unknown().optional(),
});
const toolReply = z.object({
  isError: z.boolean().optional(),
  structuredContent: object.optional(),
  content: z
    .array(z.object({ type: z.string(), text: z.string().optional() }))
    .optional(),
});

/** Private, owned stdio process; no user-supplied program, path, script or command line. */
function startCrucible(jobs: string, signal: AbortSignal) {
  const configuredCli = process.env.MEDIA_HUB_PREVIS_CRUCIBLE_CLI?.trim();
  const cli =
    configuredCli === undefined || configuredCli === ""
      ? join(
          dirname(
            createRequire(import.meta.url).resolve(
              "@codepawlhq/crucible/package.json",
            ),
          ),
          "bin/crucible-mcp.mjs",
        )
      : configuredCli;
  if (!isAbsolute(cli)) throw new Error("Crucible CLI 必须为绝对路径");
  const args = [cli, "--backend", "cpu", "--memory", "384", "--jobs", jobs];
  if (process.env.MEDIA_HUB_PREVIS_BROWSER)
    args.push("--browser", process.env.MEDIA_HUB_PREVIS_BROWSER);
  if (process.env.FFMPEG_PATH) args.push("--ffmpeg", process.env.FFMPEG_PATH);
  const child = spawn(process.execPath, args, {
    detached: process.platform !== "win32",
    env: {
      ...process.env,
      CI: "1",
      NO_UPDATE_NOTIFIER: "1",
      SIXTYSEVENJS_NO_UPDATE_CHECK: "1",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let sequence = 0;
  let stderr = "";
  const pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const exited = new Promise<void>((resolve) =>
    child.once("close", () => resolve()),
  );
  const rejectPending = (error: Error) => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    pending.clear();
  };
  child.stderr.on("data", (bytes: Buffer) => {
    stderr = (stderr + bytes.toString()).slice(-4000);
  });
  child.once("error", (error) => rejectPending(error));
  child.once("exit", () =>
    rejectPending(new Error(`Crucible 进程中断：${stderr.slice(-1500)}`)),
  );
  child.stdin.on("error", (error) => rejectPending(error));
  const wire = createInterface({ input: child.stdout });
  wire.on("line", (line) => {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      return;
    }
    const parsed = rpcReply.safeParse(value);
    if (!parsed.success) return;
    const request = pending.get(parsed.data.id);
    if (!request) return;
    pending.delete(parsed.data.id);
    clearTimeout(request.timer);
    if (parsed.data.error)
      request.reject(
        new Error(`Crucible RPC：${JSON.stringify(parsed.data.error)}`),
      );
    else request.resolve(parsed.data.result);
  });
  const kill = () => {
    rejectPending(new Error("白模执行已停止"));
    try {
      if (child.pid && process.platform !== "win32")
        process.kill(-child.pid, "SIGKILL");
      else child.kill("SIGKILL");
    } catch {
      /* Already exited. */
    }
  };
  signal.addEventListener("abort", kill, { once: true });
  const request = (method: string, params: unknown): Promise<unknown> => {
    signal.throwIfAborted();
    if (child.exitCode !== null || child.signalCode !== null)
      return Promise.reject(
        new Error(`Crucible 已退出：${stderr.slice(-1500)}`),
      );
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Crucible 请求超时：${method}`));
        kill();
      }, 90_000);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
      );
    });
  };
  return {
    async initialize() {
      await request("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "media-hub-previs", version: "1.0.0" },
      });
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
      );
    },
    async call(name: string, args: unknown) {
      const result = toolReply.parse(
        await request("tools/call", { name, arguments: args }),
      );
      if (result.isError)
        throw new Error(
          result.content?.map((block) => block.text ?? "").join(" ") ??
            "Crucible 执行失败",
        );
      if (result.structuredContent) return result.structuredContent;
      const text = result.content?.find((block) => block.type === "text")?.text;
      if (!text) throw new Error("Crucible 未返回结果");
      return object.parse(JSON.parse(text));
    },
    async close() {
      child.stdin.end();
      await Promise.race([exited, delay(2000)]);
      kill();
      await exited;
      signal.removeEventListener("abort", kill);
      wire.close();
    },
  };
}

export interface PrevisEngineOutput {
  content: Buffer;
  contentType: "image/png" | "video/mp4";
  checksum: string;
  width: number;
  height: number;
  frameCount: number;
  fps: number;
  durationSeconds: number;
  metadata: Record<string, unknown>;
}

export function prepareCrucibleRenderRecipe(
  source: unknown,
  spec: MediaPrevisRenderSpec,
) {
  const recipe = mediaPrevisRecipeSchema.parse(source);
  // 0.20.0 exports the automatic fog default as null, but its MCP input accepts
  // only numbers/omission. Omission round-trips to the same canonical default.
  if (recipe.environment?.fogDensity === null)
    delete recipe.environment.fogDensity;
  if (spec.camera) {
    recipe.camera = spec.camera;
    if (recipe.motion)
      recipe.motion.tracks = recipe.motion.tracks.filter(
        (track) => track.kind !== "camera",
      );
    if (recipe.motion?.tracks.length === 0) delete recipe.motion;
  }
  let padding = 0;
  if (recipe.motion && !recipe.motion.loop && spec.profile === "h3_reference") {
    const end = spec.sampleTime + spec.durationSeconds;
    padding = Math.max(0, end - recipe.motion.duration);
    recipe.motion.duration = Math.max(recipe.motion.duration, end);
  }
  return { recipe, padding };
}

export async function renderPrevisItem(input: {
  recipe: unknown;
  spec: MediaPrevisRenderSpec;
  signal: AbortSignal;
  onJob: (engineJobId: string) => Promise<void>;
}): Promise<PrevisEngineOutput> {
  input.signal.throwIfAborted();
  const spec = input.spec;
  const { recipe, padding } = prepareCrucibleRenderRecipe(input.recipe, spec);
  const dir = await mkdtemp(join(tmpdir(), "media-hub-crucible-"));
  let engine: ReturnType<typeof startCrucible> | undefined;
  try {
    engine = startCrucible(dir, input.signal);
    await engine.initialize();
    const session = z
      .object({ sessionId: z.string().uuid(), revision: z.number() })
      .parse(await engine.call("scene_create", { recipe }));
    const settings = {
      kind: spec.outputType,
      width: spec.width,
      height: spec.height,
      ...(spec.outputType === "video"
        ? { fps: spec.fps, duration: spec.durationSeconds, encoder: "cpu" }
        : {}),
      ...(recipe.motion ? { motion: { start: spec.sampleTime } } : {}),
      rendererTime: { start: spec.sampleTime, rate: 1 },
    };
    const job = z.object({ jobId: z.string().uuid() }).parse(
      await engine.call("scene_render_submit", {
        sessionId: session.sessionId,
        expectedRevision: session.revision,
        settings,
      }),
    );
    await input.onJob(job.jobId);
    for (;;) {
      input.signal.throwIfAborted();
      const status = await engine.call("scene_render_status", {
        jobId: job.jobId,
      });
      if (status.state === "completed") break;
      if (["failed", "canceled", "interrupted"].includes(String(status.state)))
        throw new Error(
          `Crucible ${String(status.state)}：${JSON.stringify(status.error ?? status).slice(0, 1500)}`,
        );
      await delay(300, undefined, { signal: input.signal });
    }
    const result = z
      .object({
        artifacts: z
          .array(
            z.object({
              path: z.string(),
              bytes: z.number(),
              sha256: z.string(),
            }),
          )
          .length(1),
        metrics: object,
      })
      .parse(
        await engine.call("scene_render_result", {
          jobId: job.jobId,
          response_format: "detailed",
        }),
      );
    const artifact = result.artifacts[0];
    if (!artifact) throw new Error("Crucible 未返回产物");
    const path = await realpath(artifact.path);
    const inside = relative(await realpath(dir), path);
    if (inside.startsWith(`..${sep}`) || inside === ".." || isAbsolute(inside))
      throw new Error("Crucible 产物路径越界");
    const info = await stat(path);
    if (
      !info.isFile() ||
      info.size > 50_000_000 ||
      info.size !== artifact.bytes
    )
      throw new Error("白模产物大小无效或超过 50 MB");
    const content = await readFile(path);
    const checksum = createHash("sha256").update(content).digest("hex");
    if (checksum !== artifact.sha256)
      throw new Error("Crucible 产物校验和不匹配");
    let actual = {
      width: spec.width,
      height: spec.height,
      frameCount: 1,
      fps: spec.fps,
      durationSeconds: 0,
    };
    if (spec.outputType === "image") {
      if (
        content.length < 24 ||
        !content
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      )
        throw new Error("白模产物不是 PNG");
      actual.width = content.readUInt32BE(16);
      actual.height = content.readUInt32BE(20);
    } else {
      const { stdout } = await execFileAsync(
        process.env.FFPROBE_PATH ?? "ffprobe",
        [
          "-v",
          "error",
          "-protocol_whitelist",
          "file,pipe",
          "-count_frames",
          "-show_streams",
          "-show_format",
          "-of",
          "json",
          path,
        ],
        { timeout: 30_000, maxBuffer: 2_000_000, signal: input.signal },
      );
      const probe = z
        .object({
          streams: z.array(
            z.object({
              codec_type: z.string().optional(),
              codec_name: z.string().optional(),
              width: z.number().optional(),
              height: z.number().optional(),
              avg_frame_rate: z.string().optional(),
              nb_read_frames: z.string().optional(),
              duration: z.string().optional(),
            }),
          ),
        })
        .parse(JSON.parse(stdout));
      const video = probe.streams.find(
        (stream) => stream.codec_type === "video",
      );
      const [numerator, denominator] = (video?.avg_frame_rate ?? "0/1")
        .split("/")
        .map(Number);
      actual = {
        width: video?.width ?? 0,
        height: video?.height ?? 0,
        frameCount: Number(video?.nb_read_frames),
        fps: (numerator ?? 0) / (denominator ?? 1),
        durationSeconds: Number(video?.duration),
      };
      if (
        video?.codec_name !== "h264" ||
        actual.frameCount !== spec.frameCount ||
        Math.abs(actual.fps - spec.fps) > 0.001 ||
        !Number.isFinite(actual.durationSeconds) ||
        Math.abs(actual.durationSeconds - spec.durationSeconds) > 1 / spec.fps
      )
        throw new Error("视频实际帧数、帧率或编码与请求不符");
      if (spec.profile === "h3_reference")
        referenceVideoProbeMetadata(probe, {
          width: spec.width,
          height: spec.height,
          durationSeconds: spec.nominalDurationSeconds,
        });
    }
    if (actual.width !== spec.width || actual.height !== spec.height)
      throw new Error("引擎缩小了输出尺寸，请降低尺寸后重试");
    return {
      content,
      contentType: spec.outputType === "image" ? "image/png" : "video/mp4",
      checksum: `sha256:${checksum}`,
      ...actual,
      metadata: {
        engineVersion: spec.engineVersion,
        backend: "cpu",
        engineJobId: job.jobId,
        engineMetrics: result.metrics,
        nominalDurationSeconds: spec.nominalDurationSeconds,
        motionPaddingSeconds: padding,
        frameConversion: "none",
        cameraMode: spec.viewId ? "fixed_view" : "scene_camera",
      },
    };
  } finally {
    try {
      await engine?.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
