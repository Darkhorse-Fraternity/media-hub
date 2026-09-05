import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { and, asc, eq, inArray } from "@acme/db";
import { db } from "@acme/db/client";
import {
  mediaGenerationJob,
  mediaTask,
  mediaUserPreference,
  user as User,
} from "@acme/db/schema";
import { log } from "@acme/logger";
import { getMediaHubObject, putMediaHubObject } from "@acme/storage";

import { sendGenerationResultCard } from "./feishu-notify";
import {
  GenerationOutputValidationError,
  validateGeneratedVideoOutput,
} from "./generation-output-validation";
import {
  GenerationSpeechValidationError,
  validateGeneratedDialogue,
} from "./generation-speech-validation";
import {
  acquireGenerationGpuLease,
  cancelGenerationGpuRequest,
  generationGpuRequestId,
  GpuBrokerError,
  releaseGenerationGpuLease,
  startGenerationGpuHeartbeat,
} from "./gpu-resource-broker";
import {
  H3_FPS,
  H3_I2VA_ALIGNMENT,
  H3_SEGMENT_FRAMES,
  h3SegmentCount,
  h3SegmentPrompts,
} from "./h3-generation-config";
import {
  checksumProviderValue,
  providerOrchestrationRunId,
} from "./provider-contract";
import {
  ProviderRequestError,
  requestGenerationProvider,
} from "./provider-request";
import { extractMediaGenerationLastFrame } from "./video-frame";

const execFileAsync = promisify(execFile);
const PROVIDER_CONTRACT = "ydc_generated_media_provider_request.v1";
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let recoveryStarted = false;
let providerHealthCache:
  | { expiresAt: number; value: MediaGenerationProviderHealth }
  | undefined;

export interface MediaGenerationProviderHealth {
  status: "healthy" | "unreachable" | "misconfigured";
  latencyMs: number | null;
  checkedAt: string;
  message: string;
  providerVersion: string | null;
  profiles: MediaGenerationProviderProfile[];
}

export interface MediaGenerationProviderProfile {
  id: string;
  kind: "generate" | "edit";
  adapter: string | null;
  workflowVersion: string | null;
  modelVersion: string | null;
  maxReferenceImages: number | null;
  minimumSteps: number | null;
}

interface ProviderHealthProfile {
  id?: string;
  kind?: string;
  adapter?: string;
  workflow_version?: string;
  model_version?: string;
  max_reference_images?: number;
  minimum_steps?: number;
}

function normalizeProviderProfiles(
  profileIds: string[] | undefined,
  details: ProviderHealthProfile[] | undefined,
): MediaGenerationProviderProfile[] {
  const detailById = new Map(
    (details ?? [])
      .filter(
        (profile): profile is ProviderHealthProfile & { id: string } =>
          typeof profile.id === "string",
      )
      .map((profile) => [profile.id, profile]),
  );
  return (profileIds ?? [])
    .filter((id) => {
      const kind = detailById.get(id)?.kind;
      if (kind) return kind === "generate" || kind === "edit";
      return !id.includes("hidream");
    })
    .map((id) => {
      const detail = detailById.get(id);
      const kind =
        detail?.kind === "edit" ||
        (!detail?.kind && id.toLowerCase().includes("ref2va"))
          ? "edit"
          : "generate";
      return {
        id,
        kind,
        adapter: detail?.adapter ?? null,
        workflowVersion: detail?.workflow_version ?? null,
        modelVersion: detail?.model_version ?? null,
        maxReferenceImages:
          typeof detail?.max_reference_images === "number"
            ? detail.max_reference_images
            : null,
        minimumSteps:
          typeof detail?.minimum_steps === "number"
            ? detail.minimum_steps
            : null,
      };
    });
}

interface ProviderSample {
  sample_id?: string;
  content_base64?: string;
  content_type?: string;
}

interface ProviderJob {
  job_id: string;
  status: string;
  error_message?: string;
  error_code?: string;
  failure_stage?: string;
  retryable?: boolean;
  model_version?: string;
  workflow_version?: string;
  samples?: ProviderSample[];
}

class GenerationProviderJobError extends Error {
  readonly code: string;
  readonly failureStage: string;
  readonly retryable: boolean;

  constructor(job: ProviderJob) {
    super(job.error_message ?? `生成任务${job.status}`);
    this.name = "GenerationProviderJobError";
    this.code = job.error_code ?? `provider_job_${job.status}`;
    this.failureStage = job.failure_stage ?? "provider_execution";
    this.retryable = job.retryable ?? job.status === "failed";
  }
}

function structuredGenerationFailure(error: unknown): {
  code: string;
  failureStage: string;
  retryable: boolean;
} {
  if (
    error instanceof GenerationProviderJobError ||
    error instanceof GenerationOutputValidationError ||
    error instanceof GenerationSpeechValidationError ||
    error instanceof GpuBrokerError
  ) {
    return {
      code: error.code,
      failureStage: error.failureStage,
      retryable: error.retryable,
    };
  }
  if (error instanceof ProviderRequestError) {
    return {
      code: error.status
        ? `provider_http_${error.status}`
        : "provider_transport_failed",
      failureStage: "provider_transport",
      retryable: error.retryable,
    };
  }
  return {
    code: "generation_pipeline_failed",
    failureStage: "media_hub_orchestration",
    retryable: true,
  };
}

function providerConfig() {
  const baseUrl = process.env.MEDIA_HUB_GENERATION_PROVIDER_URL?.trim();
  const token = process.env.MEDIA_HUB_GENERATION_PROVIDER_TOKEN?.trim();
  if (!baseUrl || !token) {
    throw new Error(
      "Missing MEDIA_HUB_GENERATION_PROVIDER_URL or MEDIA_HUB_GENERATION_PROVIDER_TOKEN",
    );
  }
  return { baseUrl: baseUrl.replace(/\/$/, ""), token };
}

async function providerRequest<T>(
  path: string,
  init: RequestInit = {},
  options: { timeoutMs?: number; maxAttempts?: number } = {},
): Promise<T> {
  const { baseUrl, token } = providerConfig();
  return requestGenerationProvider<T>({
    baseUrl,
    token,
    path,
    init,
    ...options,
    onRetry: ({ attempt, maxAttempts, delayMs, error }) => {
      log.warn("H3 provider request will retry", {
        code: "MEDIA_GENERATION_PROVIDER_RETRY",
        path,
        attempt,
        max_attempts: maxAttempts,
        delay_ms: delayMs,
        err: error,
      });
    },
  });
}

export async function getMediaGenerationProviderHealth(
  force = false,
): Promise<MediaGenerationProviderHealth> {
  const now = Date.now();
  if (!force && providerHealthCache && providerHealthCache.expiresAt > now) {
    return providerHealthCache.value;
  }

  const checkedAt = new Date().toISOString();
  const startedAt = performance.now();
  let value: MediaGenerationProviderHealth;
  try {
    providerConfig();
    const health = await providerRequest<{
      status?: string;
      contract?: string;
      profiles?: string[];
      profile_details?: ProviderHealthProfile[];
      provider_version?: string;
    }>(
      "/healthz",
      {},
      {
        timeoutMs: 5_000,
        maxAttempts: 2,
      },
    );
    if (health.status !== "healthy") {
      throw new Error(`H3 Provider 状态异常：${health.status ?? "unknown"}`);
    }
    if (health.contract !== PROVIDER_CONTRACT) {
      throw new Error(
        `H3 Provider 协议不匹配：${health.contract ?? "unknown"}`,
      );
    }
    const profiles = normalizeProviderProfiles(
      health.profiles,
      health.profile_details,
    );
    if (!profiles.length) throw new Error("H3 Provider 未注册可用工作流");
    value = {
      status: "healthy",
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      checkedAt,
      message: "H3 Provider 链路正常",
      providerVersion: health.provider_version ?? null,
      profiles,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    value = {
      status: message.startsWith("Missing ") ? "misconfigured" : "unreachable",
      latencyMs: null,
      checkedAt,
      message,
      providerVersion: null,
      profiles: [],
    };
  }

  providerHealthCache = { expiresAt: now + 5_000, value };
  return value;
}

function checksumBytes(value: Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function h3FrameCount(durationSeconds: number): number {
  const requestedFrames = Math.ceil(durationSeconds * H3_FPS);
  const aligned = Math.ceil((Math.max(5, requestedFrames) - 5) / 17) * 17 + 5;
  return Math.min(H3_SEGMENT_FRAMES, Math.max(56, aligned));
}

function fallbackJobSeed(job: typeof mediaGenerationJob.$inferSelect): number {
  return Number.parseInt(
    createHash("sha256").update(job.id).digest("hex").slice(0, 7),
    16,
  );
}

async function createProviderJob(
  job: typeof mediaGenerationJob.$inferSelect,
  segmentPrompt: string,
  segmentIndex: number,
  continuationFrame?: Buffer,
) {
  let sourceArtifacts: Record<string, string>[] = [];
  let firstFrame:
    | { content: Buffer; name: string; contentType: string }
    | undefined;
  if (continuationFrame) {
    firstFrame = {
      content: continuationFrame,
      name: `segment-${segmentIndex}-continuity.png`,
      contentType: "image/png",
    };
  } else if (job.sourceImageStorageKey) {
    firstFrame = {
      content: await getMediaHubObject(job.sourceImageStorageKey),
      name: job.sourceImageName ?? "source.png",
      contentType: job.sourceImageContentType ?? "image/png",
    };
  }
  if (firstFrame) {
    sourceArtifacts = [
      {
        name: firstFrame.name,
        content_type: firstFrame.contentType,
        checksum: checksumBytes(firstFrame.content),
        contract: "generated_media_source.v1",
        role: "first_frame",
        content_base64: firstFrame.content.toString("base64"),
      },
    ];
  }
  const referenceArtifacts = await Promise.all(
    job.referenceImages.map(async (reference) => {
      const content = await getMediaHubObject(reference.storageKey);
      return {
        name: reference.name,
        content_type: reference.contentType,
        checksum: checksumBytes(content),
        contract: "generated_media_source.v1",
        role: reference.role,
        content_base64: content.toString("base64"),
      };
    }),
  );
  sourceArtifacts = [...sourceArtifacts, ...referenceArtifacts];

  const segmentDurationSeconds =
    job.durationSeconds / h3SegmentCount(job.durationSeconds);
  const effectivePrompt =
    firstFrame && !segmentPrompt.includes(H3_I2VA_ALIGNMENT)
      ? `${H3_I2VA_ALIGNMENT}\n\n${segmentPrompt}`
      : segmentPrompt;
  const generationSpec = {
    profile: job.profile,
    parameters: {
      behavior_prompts: { main: effectivePrompt },
      negative_prompt:
        "low quality, blurry, distorted anatomy, temporal flicker, duplicate objects, watermark",
      width: job.width,
      height: job.height,
      length: h3FrameCount(segmentDurationSeconds),
      fps: H3_FPS,
      steps: job.steps,
      cfg: 1,
      seed: (job.seed ?? fallbackJobSeed(job)) + segmentIndex,
    },
  };
  const payload = {
    schema_version: PROVIDER_CONTRACT,
    orchestration_run_id: `${providerOrchestrationRunId(
      job.id,
      job.startedAt ?? job.createdAt,
    )}:segment:${segmentIndex + 1}`,
    project_id: "pumpkii-media-hub",
    attempt: 1,
    deficits: { main: 1 },
    max_outputs: 1,
    generation_spec: generationSpec,
    generation_spec_checksum: checksumProviderValue(generationSpec),
    source_artifacts: sourceArtifacts,
  };

  return providerRequest<ProviderJob>(
    "/v1/generated-media/jobs",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    { timeoutMs: 20_000, maxAttempts: 3 },
  );
}

async function createEditProviderJob(
  job: typeof mediaGenerationJob.$inferSelect,
  segment: (typeof job.editSegments)[number],
  sourceVideo: Buffer,
) {
  const referenceArtifacts = await Promise.all(
    segment.referenceImages.map(async (reference) => {
      const content = await getMediaHubObject(reference.storageKey);
      return {
        name: reference.name,
        content_type: reference.contentType,
        checksum: checksumBytes(content),
        contract: "generated_media_source.v1",
        role: reference.role,
        content_base64: content.toString("base64"),
      };
    }),
  );
  const generationSpec = {
    profile: job.profile,
    parameters: {
      behavior_prompts: { main: segment.prompt },
      negative_prompt: "",
      width: job.width,
      height: job.height,
      length: h3FrameCount(segment.endSeconds - segment.startSeconds),
      fps: H3_FPS,
      steps: 20,
      cfg: 1,
      preserve_source_audio: segment.preserveSourceAudio,
    },
  };
  const sourceArtifacts = [
    {
      name: `source-${segment.id}.mp4`,
      content_type: "video/mp4",
      checksum: checksumBytes(sourceVideo),
      contract: "generated_media_source.v1",
      role: "source_video",
      content_base64: sourceVideo.toString("base64"),
    },
    ...referenceArtifacts,
  ];
  const payload = {
    schema_version: PROVIDER_CONTRACT,
    orchestration_run_id: `${job.id}:${segment.id}`,
    project_id: "pumpkii-media-hub",
    attempt: 1,
    deficits: { main: 1 },
    max_outputs: 1,
    generation_spec: generationSpec,
    generation_spec_checksum: checksumProviderValue(generationSpec),
    source_artifacts: sourceArtifacts,
  };
  return providerRequest<ProviderJob>("/v1/generated-media/jobs", {
    method: "POST",
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(120_000),
  });
}

async function waitForProviderJob(
  providerJobId: string,
  assertLeaseHealthy: () => void = () => undefined,
): Promise<ProviderJob> {
  const deadline = Date.now() + 60 * 60 * 1000;
  while (Date.now() < deadline) {
    assertLeaseHealthy();
    const current = await providerRequest<ProviderJob>(
      `/v1/generated-media/jobs/${encodeURIComponent(providerJobId)}`,
    );
    if (["succeeded", "failed", "canceled"].includes(current.status)) {
      if (current.status !== "succeeded") {
        throw new GenerationProviderJobError(current);
      }
      return current;
    }
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  throw new Error("MiniMax H3 生成超时（超过 1 小时）");
}

async function joinVideoSamples(samples: ProviderSample[]): Promise<Buffer> {
  const contents = samples
    .map((sample) => sample.content_base64)
    .filter((value): value is string => Boolean(value))
    .map((value) => Buffer.from(value, "base64"));
  if (!contents.length) throw new Error("生成服务没有返回视频文件");
  if (contents.length === 1) {
    const first = contents.at(0);
    if (!first) throw new Error("生成服务没有返回视频文件");
    return first;
  }

  const dir = await mkdtemp(join(tmpdir(), "media-hub-h3-"));
  try {
    const listPath = join(dir, "concat.txt");
    const outputPath = join(dir, "joined.mp4");
    const lines: string[] = [];
    for (const [index, content] of contents.entries()) {
      const filePath = join(dir, `segment-${index}.mp4`);
      await writeFile(filePath, content);
      lines.push(`file '${filePath}'`);
    }
    await writeFile(listPath, `${lines.join("\n")}\n`);
    const ffmpeg = process.env.FFMPEG_PATH ?? "ffmpeg";
    await execFileAsync(ffmpeg, [
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

interface GenerationPipelineResult {
  video: Buffer;
  providerJobIds: string[];
  modelVersion: string | null;
  workflowVersion: string | null;
}

async function runVideoGenerationPipeline(
  job: typeof mediaGenerationJob.$inferSelect,
  assertLeaseHealthy: () => void,
): Promise<GenerationPipelineResult> {
  const totalSegments = h3SegmentCount(job.durationSeconds);
  const prompts = h3SegmentPrompts(job.prompt, totalSegments);
  const providerJobIds: string[] = [];
  const samples: ProviderSample[] = [];
  let continuationFrame: Buffer | undefined;
  let modelVersion: string | null = null;
  let workflowVersion: string | null = null;

  for (const [segmentIndex, segmentPrompt] of prompts.entries()) {
    assertLeaseHealthy();
    const current = await db.query.mediaGenerationJob.findFirst({
      where: eq(mediaGenerationJob.id, job.id),
      columns: { status: true },
    });
    if (current?.status !== "running") {
      throw new Error(`生成任务已停止（${current?.status ?? "missing"}）`);
    }
    const submitted = await createProviderJob(
      job,
      segmentPrompt,
      segmentIndex,
      continuationFrame,
    );
    providerJobIds.push(submitted.job_id);
    const [runningUpdate] = await db
      .update(mediaGenerationJob)
      .set({
        providerJobId: submitted.job_id,
        providerJobIds: [...providerJobIds],
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(mediaGenerationJob.id, job.id),
          eq(mediaGenerationJob.status, "running"),
        ),
      )
      .returning({ id: mediaGenerationJob.id });
    if (!runningUpdate) {
      try {
        await providerRequest(
          `/v1/generated-media/jobs/${encodeURIComponent(submitted.job_id)}:cancel`,
          { method: "POST", body: "{}" },
        );
      } catch {
        // The local canceled state remains authoritative.
      }
      throw new Error("生成任务已停止");
    }

    const completed = await waitForProviderJob(
      submitted.job_id,
      assertLeaseHealthy,
    );
    modelVersion = completed.model_version ?? modelVersion;
    workflowVersion = completed.workflow_version ?? workflowVersion;
    const segmentVideo = await joinVideoSamples(completed.samples ?? []);
    samples.push({
      content_base64: segmentVideo.toString("base64"),
      content_type: "video/mp4",
    });
    if (segmentIndex + 1 < totalSegments) {
      continuationFrame = await extractMediaGenerationLastFrame(segmentVideo);
    }
  }

  return {
    video: await joinVideoSamples(samples),
    providerJobIds,
    modelVersion,
    workflowVersion,
  };
}

async function extractEditSourceClip(
  sourcePath: string,
  outputPath: string,
  startSeconds: number,
  durationSeconds: number,
  width: number,
  height: number,
): Promise<void> {
  const ffmpeg = process.env.FFMPEG_PATH ?? "ffmpeg";
  await execFileAsync(ffmpeg, [
    "-ss",
    startSeconds.toFixed(3),
    "-t",
    durationSeconds.toFixed(3),
    "-i",
    sourcePath,
    "-vf",
    `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=${H3_FPS},format=yuv420p`,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-c:a",
    "aac",
    "-ar",
    "48000",
    "-ac",
    "2",
    "-movflags",
    "+faststart",
    outputPath,
    "-y",
    "-loglevel",
    "error",
  ]);
}

async function mergeEditedSegments(
  sourcePath: string,
  editedPaths: string[],
  outputPath: string,
  segments: (typeof mediaGenerationJob.$inferSelect)["editSegments"],
  durationSeconds: number,
  width: number,
  height: number,
): Promise<void> {
  const inputs = ["-i", sourcePath];
  for (const editedPath of editedPaths) inputs.push("-i", editedPath);

  const filters: string[] = [];
  const videoLabels: string[] = [];
  let cursor = 0;
  let outputIndex = 0;
  const addSourceRange = (start: number, end: number) => {
    if (end - start < 0.001) return;
    const label = `v${outputIndex++}`;
    filters.push(
      `[0:v]trim=start=${start.toFixed(3)}:end=${end.toFixed(3)},setpts=PTS-STARTPTS,fps=${H3_FPS},scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p[${label}]`,
    );
    videoLabels.push(`[${label}]`);
  };
  for (const [index, segment] of segments.entries()) {
    addSourceRange(cursor, segment.startSeconds);
    const label = `v${outputIndex++}`;
    const clipDuration = segment.endSeconds - segment.startSeconds;
    filters.push(
      `[${index + 1}:v]trim=duration=${clipDuration.toFixed(3)},setpts=PTS-STARTPTS,fps=${H3_FPS},scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p[${label}]`,
    );
    videoLabels.push(`[${label}]`);
    cursor = segment.endSeconds;
  }
  addSourceRange(cursor, durationSeconds);
  if (videoLabels.length === 1) {
    filters.push(`${videoLabels[0]}null[vout]`);
  } else {
    filters.push(
      `${videoLabels.join("")}concat=n=${videoLabels.length}:v=1:a=0[vout]`,
    );
  }

  const ffmpeg = process.env.FFMPEG_PATH ?? "ffmpeg";
  await execFileAsync(ffmpeg, [
    ...inputs,
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[vout]",
    "-map",
    "0:a?",
    "-t",
    durationSeconds.toFixed(3),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-movflags",
    "+faststart",
    outputPath,
    "-y",
    "-loglevel",
    "error",
  ]);
}

async function runVideoEditPipeline(
  job: typeof mediaGenerationJob.$inferSelect,
  assertLeaseHealthy: () => void,
): Promise<GenerationPipelineResult> {
  const sourceJob = job.sourceGenerationJobId
    ? await db.query.mediaGenerationJob.findFirst({
        where: eq(mediaGenerationJob.id, job.sourceGenerationJobId),
      })
    : null;
  if (!sourceJob?.outputStorageKey || sourceJob.status !== "succeeded") {
    throw new Error("源视频不存在或已经不可用");
  }
  if (!job.editSegments.length) throw new Error("编辑任务没有时间片段");

  const dir = await mkdtemp(join(tmpdir(), "media-hub-ref2va-"));
  const providerJobIds: string[] = [];
  let modelVersion: string | null = null;
  let workflowVersion: string | null = null;
  try {
    const sourcePath = join(dir, "source.mp4");
    const outputPath = join(dir, "edited.mp4");
    await writeFile(
      sourcePath,
      await getMediaHubObject(sourceJob.outputStorageKey),
    );
    const editedPaths: string[] = [];
    for (const [index, segment] of job.editSegments.entries()) {
      assertLeaseHealthy();
      const current = await db.query.mediaGenerationJob.findFirst({
        where: eq(mediaGenerationJob.id, job.id),
        columns: { status: true },
      });
      if (current?.status !== "running") {
        throw new Error(`编辑任务已停止（${current?.status ?? "missing"}）`);
      }
      const clipPath = join(dir, `source-segment-${index}.mp4`);
      const editedPath = join(dir, `edited-segment-${index}.mp4`);
      await extractEditSourceClip(
        sourcePath,
        clipPath,
        segment.startSeconds,
        segment.endSeconds - segment.startSeconds,
        job.width,
        job.height,
      );
      const submitted = await createEditProviderJob(
        job,
        segment,
        await readFile(clipPath),
      );
      providerJobIds.push(submitted.job_id);
      await db
        .update(mediaGenerationJob)
        .set({
          providerJobId: submitted.job_id,
          providerJobIds: [...providerJobIds],
          updatedAt: new Date(),
        })
        .where(eq(mediaGenerationJob.id, job.id));
      const completed = await waitForProviderJob(
        submitted.job_id,
        assertLeaseHealthy,
      );
      modelVersion = completed.model_version ?? modelVersion;
      workflowVersion = completed.workflow_version ?? workflowVersion;
      await writeFile(
        editedPath,
        await joinVideoSamples(completed.samples ?? []),
      );
      editedPaths.push(editedPath);
    }
    await mergeEditedSegments(
      sourcePath,
      editedPaths,
      outputPath,
      job.editSegments,
      job.durationSeconds,
      job.width,
      job.height,
    );
    return {
      video: await readFile(outputPath),
      providerJobIds,
      modelVersion,
      workflowVersion,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function createDraftFromGeneration(
  job: typeof mediaGenerationJob.$inferSelect,
  outputStorageKey: string,
): Promise<string> {
  const now = new Date();
  const taskId = crypto.randomUUID();
  const requestedTitle = job.title?.trim();
  const title =
    requestedTitle && requestedTitle.length > 0
      ? requestedTitle
      : `${job.language === "en" ? "AI Video" : "AI 视频"}: ${job.prompt.slice(0, eightyChars(job.prompt))}`;
  await db.insert(mediaTask).values({
    id: taskId,
    title,
    description: job.prompt,
    language: job.language,
    videoStorageKey: outputStorageKey,
    aiPrompts: {
      source: job.kind === "edit" ? "minimax-h3-ref2va" : "minimax-h3",
      generationJobId: job.id,
      sourceGenerationJobId: job.sourceGenerationJobId,
      editSegments: job.editSegments,
      prompt: job.prompt,
      durationSeconds: job.durationSeconds,
      language: job.language,
      qualityPreset: job.qualityPreset,
      steps: job.steps,
      seed: job.seed ?? fallbackJobSeed(job),
      profile: job.profile,
      resolution: `${job.width}x${job.height}`,
    },
    status: "draft",
    createdBy: job.createdBy,
    createdAt: now,
    updatedAt: now,
  });
  return taskId;
}

function eightyChars(value: string): number {
  return Math.min(value.length, 80);
}

async function runGenerationJob(jobId: string): Promise<void> {
  const claimedAt = new Date();
  const brokerRequestId = generationGpuRequestId(jobId);
  const [job] = await db
    .update(mediaGenerationJob)
    .set({
      status: "waiting_for_gpu",
      gpuBrokerRequestId: brokerRequestId,
      gpuBrokerLeaseId: null,
      updatedAt: claimedAt,
    })
    .where(
      and(
        eq(mediaGenerationJob.id, jobId),
        inArray(mediaGenerationJob.status, ["scheduled", "queued"]),
      ),
    )
    .returning();
  if (!job) return;
  let startedAt = job.startedAt ?? claimedAt;
  if (job.seed === null) {
    job.seed = fallbackJobSeed(job);
    await db
      .update(mediaGenerationJob)
      .set({ seed: job.seed, updatedAt: new Date() })
      .where(eq(mediaGenerationJob.id, job.id));
  }

  const notifyResult = async (
    status: "succeeded" | "failed",
    finishedAt: Date,
    errorMessage?: string,
    errorCode?: string,
    failureStage?: string,
    errorRetryable?: boolean,
    video?: Buffer,
    providerJobId?: string,
    modelVersion?: string | null,
    workflowVersion?: string | null,
  ) => {
    const [creator, recipientPreference] = await Promise.all([
      db.query.user.findFirst({
        where: eq(User.id, job.createdBy),
        columns: { name: true, email: true },
      }),
      db.query.mediaUserPreference.findFirst({
        where: eq(mediaUserPreference.userId, job.createdBy),
        columns: { feishuWebhookUrl: true },
      }),
    ]);
    const appUrl = process.env.APP_URL?.replace(/\/$/, "");
    await sendGenerationResultCard({
      jobId: job.id,
      title: job.title,
      prompt: job.prompt,
      status,
      operation: job.kind === "edit" ? "edit" : "generate",
      editSegmentCount: job.editSegments.length,
      durationSeconds: job.durationSeconds,
      language: job.language,
      elapsedSeconds: (finishedAt.getTime() - startedAt.getTime()) / 1000,
      fps: job.fps,
      width: job.width,
      height: job.height,
      qualityPreset: job.qualityPreset,
      steps: job.steps,
      seed: job.seed,
      profile: job.profile,
      modelVersion,
      workflowVersion,
      referenceImageCount:
        job.referenceImages.length +
        job.editSegments.reduce(
          (total, segment) => total + segment.referenceImages.length,
          0,
        ),
      hasFirstFrame: Boolean(job.sourceImageStorageKey),
      scheduledAt: job.scheduledAt,
      providerJobId,
      videoBytes: video?.length,
      createdByLabel: creator
        ? `${creator.name} (${creator.email})`
        : job.createdBy,
      errorMessage,
      errorCode,
      failureStage,
      errorRetryable,
      videoUrl: appUrl ? `${appUrl}/#generation-job-${job.id}` : undefined,
      recipientWebhookUrl: recipientPreference?.feishuWebhookUrl,
    });
  };

  let gpuLease: Awaited<ReturnType<typeof acquireGenerationGpuLease>> = null;
  let gpuHeartbeat: ReturnType<typeof startGenerationGpuHeartbeat> | null =
    null;
  const releaseGpuLease = async () => {
    await gpuHeartbeat?.stop();
    gpuHeartbeat = null;
    const lease = gpuLease;
    gpuLease = null;
    if (!lease) return;
    try {
      await releaseGenerationGpuLease(lease);
    } catch (error) {
      log.error("GPU Broker lease release failed", {
        code: "GPU_BROKER_RELEASE_FAILED",
        job_id: job.id,
        lease_id: lease.leaseId,
        err: error instanceof Error ? error : new Error(String(error)),
      });
    }
    await db
      .update(mediaGenerationJob)
      .set({ gpuBrokerLeaseId: null, updatedAt: new Date() })
      .where(eq(mediaGenerationJob.id, job.id));
  };
  try {
    gpuLease = await acquireGenerationGpuLease({
      jobId: job.id,
      kind: job.kind,
      durationSeconds: job.durationSeconds,
      isStillWaiting: async () => {
        const current = await db.query.mediaGenerationJob.findFirst({
          where: eq(mediaGenerationJob.id, job.id),
          columns: { status: true },
        });
        return current?.status === "waiting_for_gpu";
      },
    });
    const currentAfterWait = await db.query.mediaGenerationJob.findFirst({
      where: eq(mediaGenerationJob.id, job.id),
      columns: { status: true },
    });
    if (currentAfterWait?.status !== "waiting_for_gpu") return;

    startedAt = job.startedAt ?? new Date();
    job.startedAt = startedAt;
    const [runningUpdate] = await db
      .update(mediaGenerationJob)
      .set({
        status: "running",
        startedAt,
        gpuBrokerLeaseId: gpuLease?.leaseId ?? null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(mediaGenerationJob.id, job.id),
          eq(mediaGenerationJob.status, "waiting_for_gpu"),
        ),
      )
      .returning({ id: mediaGenerationJob.id });
    if (!runningUpdate) return;
    if (gpuLease) gpuHeartbeat = startGenerationGpuHeartbeat(gpuLease);
    const assertLeaseHealthy = () => gpuHeartbeat?.assertHealthy();

    const providerHealth = await getMediaGenerationProviderHealth(true);
    if (providerHealth.status !== "healthy") {
      throw new Error(`H3 生成链路安全检查失败：${providerHealth.message}`);
    }
    const expectedProfileKind = job.kind === "edit" ? "edit" : "generate";
    const activeProfile = providerHealth.profiles.find(
      (profile) => profile.id === job.profile,
    );
    if (!activeProfile) {
      throw new Error(`H3 Provider 未启用任务工作流 ${job.profile}`);
    }
    if (activeProfile.kind !== expectedProfileKind) {
      throw new Error(
        `H3 工作流 ${job.profile} 不支持${job.kind === "edit" ? "视频编辑" : "视频生成"}`,
      );
    }
    const result =
      job.kind === "edit"
        ? await runVideoEditPipeline(job, assertLeaseHealthy)
        : await runVideoGenerationPipeline(job, assertLeaseHealthy);
    const { video, providerJobIds, modelVersion, workflowVersion } = result;
    assertLeaseHealthy();
    await validateGeneratedVideoOutput(video, {
      durationSeconds: job.durationSeconds,
      width: job.width,
      height: job.height,
      fps: job.fps,
    });
    const speechValidation = await validateGeneratedDialogue(
      video,
      job.prompt,
      job.language,
    );
    assertLeaseHealthy();
    // The H3 and validation stages are complete. Do not hold the shared GPU
    // while storing the file, creating a draft, or sending notifications.
    await releaseGpuLease();
    const currentBeforeFinalize = await db.query.mediaGenerationJob.findFirst({
      where: eq(mediaGenerationJob.id, jobId),
      columns: { status: true },
    });
    if (currentBeforeFinalize?.status !== "running") return;
    const finishedAt = new Date();
    const outputStorageKey = `media-hub/${job.kind === "edit" ? "edited" : "generated"}/${job.createdBy}/${job.id}.mp4`;
    await putMediaHubObject(outputStorageKey, video, "video/mp4");
    const mediaTaskId = await createDraftFromGeneration(job, outputStorageKey);

    const [completedUpdate] = await db
      .update(mediaGenerationJob)
      .set({
        status: "succeeded",
        outputStorageKey,
        mediaTaskId,
        providerJobIds,
        modelVersion,
        workflowVersion,
        asrTranscript: speechValidation?.transcript ?? null,
        asrMatchPercent: speechValidation?.matchPercent ?? null,
        finishedAt,
        updatedAt: finishedAt,
      })
      .where(
        and(
          eq(mediaGenerationJob.id, jobId),
          eq(mediaGenerationJob.status, "running"),
        ),
      )
      .returning({ id: mediaGenerationJob.id });
    if (!completedUpdate) return;
    try {
      await notifyResult(
        "succeeded",
        finishedAt,
        undefined,
        undefined,
        undefined,
        undefined,
        video,
        providerJobIds.join(", "),
        modelVersion,
        workflowVersion,
      );
    } catch (notificationError) {
      log.error("Media generation success notification failed", {
        code: "MEDIA_GENERATION_RESULT_CARD_FAILED",
        job_id: job.id,
        status: "succeeded",
        err:
          notificationError instanceof Error
            ? notificationError
            : new Error(String(notificationError)),
      });
    }
  } catch (error) {
    const current = await db.query.mediaGenerationJob.findFirst({
      where: eq(mediaGenerationJob.id, jobId),
      columns: { status: true },
    });
    if (current?.status === "canceled") return;
    const errorMessage = (
      error instanceof Error ? error.message : String(error)
    ).slice(0, 1000);
    const structuredFailure = structuredGenerationFailure(error);
    const finishedAt = new Date();
    await db
      .update(mediaGenerationJob)
      .set({
        status: "failed",
        errorMessage,
        errorCode: structuredFailure.code,
        failureStage: structuredFailure.failureStage,
        errorRetryable: structuredFailure.retryable,
        finishedAt,
        updatedAt: finishedAt,
      })
      .where(eq(mediaGenerationJob.id, jobId));
    try {
      await notifyResult(
        "failed",
        finishedAt,
        errorMessage,
        structuredFailure.code,
        structuredFailure.failureStage,
        structuredFailure.retryable,
      );
    } catch (notificationError) {
      log.error("Media generation failure notification failed", {
        code: "MEDIA_GENERATION_RESULT_CARD_FAILED",
        job_id: job.id,
        status: "failed",
        err:
          notificationError instanceof Error
            ? notificationError
            : new Error(String(notificationError)),
      });
    }
  } finally {
    await releaseGpuLease();
  }
}

export function scheduleMediaGenerationJob(
  jobId: string,
  scheduledAt?: Date | null,
): void {
  if (timers.has(jobId)) return;
  const delay = Math.max(
    0,
    (scheduledAt?.getTime() ?? Date.now()) - Date.now(),
  );
  const timer = setTimeout(
    () => {
      // Only remove this callback's timer. A failed job may be retried while
      // its previous Feishu notification is still finishing.
      if (timers.get(jobId) === timer) timers.delete(jobId);
      void runGenerationJob(jobId);
    },
    Math.min(delay, 2_147_483_647),
  );
  timers.set(jobId, timer);
}

/** 编辑排队任务后，清除旧计时器并按新时间重新调度。 */
export function rescheduleMediaGenerationJob(
  jobId: string,
  scheduledAt?: Date | null,
): void {
  const existingTimer = timers.get(jobId);
  if (existingTimer) clearTimeout(existingTimer);
  timers.delete(jobId);
  scheduleMediaGenerationJob(jobId, scheduledAt);
}

/** 进程重启后恢复尚未执行的定时任务。 */
export function startMediaGenerationScheduler(): void {
  if (recoveryStarted) return;
  recoveryStarted = true;
  void db.query.mediaGenerationJob
    .findMany({
      where: inArray(mediaGenerationJob.status, [
        "scheduled",
        "queued",
        "waiting_for_gpu",
        "running",
      ]),
      // FIFO recovery prevents newer jobs from jumping ahead after a restart.
      orderBy: asc(mediaGenerationJob.createdAt),
    })
    .then(async (jobs) => {
      for (const job of jobs) {
        if (["waiting_for_gpu", "running"].includes(job.status)) {
          await db
            .update(mediaGenerationJob)
            .set({ status: "queued", updatedAt: new Date() })
            .where(eq(mediaGenerationJob.id, job.id));
        }
        scheduleMediaGenerationJob(
          job.id,
          job.status === "scheduled" ? job.scheduledAt : null,
        );
      }
    })
    .catch(() => {
      recoveryStarted = false;
    });
}

export async function cancelMediaGenerationJob(jobId: string): Promise<void> {
  const job = await db.query.mediaGenerationJob.findFirst({
    where: eq(mediaGenerationJob.id, jobId),
  });
  if (!job || ["succeeded", "failed", "canceled"].includes(job.status)) return;
  if (job.providerJobId) {
    try {
      await providerRequest(
        `/v1/generated-media/jobs/${encodeURIComponent(job.providerJobId)}:cancel`,
        { method: "POST", body: "{}" },
      );
    } catch {
      // 本地状态仍然要可取消；provider 可能已经完成或暂时不可达。
    }
  }
  const timer = timers.get(jobId);
  if (timer) clearTimeout(timer);
  timers.delete(jobId);
  const [canceledJob] = await db
    .update(mediaGenerationJob)
    .set({ status: "canceled", finishedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(mediaGenerationJob.id, jobId),
        eq(mediaGenerationJob.status, job.status),
      ),
    )
    .returning({ gpuBrokerRequestId: mediaGenerationJob.gpuBrokerRequestId });
  if (job.status === "waiting_for_gpu" && canceledJob?.gpuBrokerRequestId) {
    try {
      await cancelGenerationGpuRequest(canceledJob.gpuBrokerRequestId);
    } catch {
      // The request may have been granted concurrently; runGenerationJob's
      // finally block will release that lease after observing canceled state.
    }
  }
}
