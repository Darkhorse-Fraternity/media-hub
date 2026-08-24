import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { and, desc, eq, inArray } from "@acme/db";
import { db } from "@acme/db/client";
import { mediaGenerationJob, mediaTask, user as User } from "@acme/db/schema";
import { log } from "@acme/logger";
import { getMediaHubObject, putMediaHubObject } from "@acme/storage";

import { sendGenerationResultCard } from "./feishu-notify";
import {
  checksumProviderValue,
  providerOrchestrationRunId,
} from "./provider-contract";
import { requestGenerationProvider } from "./provider-request";

const execFileAsync = promisify(execFile);
const PROVIDER_CONTRACT = "ydc_generated_media_provider_request.v1";
const DEFAULT_PROFILE = "platform-h3-i2v-inline-v1";
const EDIT_PROFILE = "platform-h3-ref2va-edit-v1";
const H3_FPS = 24;
const H3_SEGMENT_FRAMES = 362;
const H3_SEGMENT_SECONDS = H3_SEGMENT_FRAMES / H3_FPS;
const FEISHU_VIDEO_MAX_BYTES = 29_000_000;
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let recoveryStarted = false;
let providerHealthCache:
  | { expiresAt: number; value: MediaGenerationProviderHealth }
  | undefined;
let generationRunChain: Promise<void> = Promise.resolve();

export interface MediaGenerationProviderHealth {
  status: "healthy" | "unreachable" | "misconfigured";
  latencyMs: number | null;
  checkedAt: string;
  message: string;
  providerVersion: string | null;
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
  samples?: ProviderSample[];
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
    if (!health.profiles?.includes(DEFAULT_PROFILE)) {
      throw new Error(`H3 Provider 未启用 ${DEFAULT_PROFILE}`);
    }
    value = {
      status: "healthy",
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      checkedAt,
      message: "H3 Provider 链路正常",
      providerVersion: health.provider_version ?? null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    value = {
      status: message.startsWith("Missing ") ? "misconfigured" : "unreachable",
      latencyMs: null,
      checkedAt,
      message,
      providerVersion: null,
    };
  }

  providerHealthCache = { expiresAt: now + 5_000, value };
  return value;
}

function checksumBytes(value: Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function segmentCount(durationSeconds: number): number {
  return Math.max(1, Math.ceil(durationSeconds / H3_SEGMENT_SECONDS));
}

function h3FrameCount(durationSeconds: number): number {
  const requestedFrames = Math.ceil(durationSeconds * H3_FPS);
  const aligned = Math.ceil((Math.max(5, requestedFrames) - 5) / 17) * 17 + 5;
  return Math.min(H3_SEGMENT_FRAMES, Math.max(56, aligned));
}

async function createProviderJob(job: typeof mediaGenerationJob.$inferSelect) {
  let sourceArtifacts: Record<string, string>[] = [];
  if (job.sourceImageStorageKey) {
    const content = await getMediaHubObject(job.sourceImageStorageKey);
    sourceArtifacts = [
      {
        name: job.sourceImageName ?? "source.png",
        content_type: job.sourceImageContentType ?? "image/png",
        checksum: checksumBytes(content),
        contract: "generated_media_source.v1",
        role: "first_frame",
        content_base64: content.toString("base64"),
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

  const generationSpec = {
    profile: DEFAULT_PROFILE,
    parameters: {
      behavior_prompts: { main: job.prompt },
      negative_prompt:
        "blurry, distorted, flicker, duplicate objects, text, watermark",
      width: job.width,
      height: job.height,
      length: H3_SEGMENT_FRAMES,
      fps: H3_FPS,
      steps: 4,
      cfg: 1,
    },
  };
  const payload = {
    schema_version: PROVIDER_CONTRACT,
    orchestration_run_id: providerOrchestrationRunId(
      job.id,
      job.startedAt ?? job.createdAt,
    ),
    project_id: "pumpkii-media-hub",
    attempt: 1,
    deficits: { main: segmentCount(job.durationSeconds) },
    max_outputs: segmentCount(job.durationSeconds),
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
    profile: EDIT_PROFILE,
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

async function waitForProviderJob(providerJobId: string): Promise<ProviderJob> {
  const deadline = Date.now() + 60 * 60 * 1000;
  while (Date.now() < deadline) {
    const current = await providerRequest<ProviderJob>(
      `/v1/generated-media/jobs/${encodeURIComponent(providerJobId)}`,
    );
    if (["succeeded", "failed", "canceled"].includes(current.status)) {
      if (current.status !== "succeeded") {
        throw new Error(current.error_message ?? `生成任务${current.status}`);
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
): Promise<{ video: Buffer; providerJobIds: string[] }> {
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
  try {
    const sourcePath = join(dir, "source.mp4");
    const outputPath = join(dir, "edited.mp4");
    await writeFile(
      sourcePath,
      await getMediaHubObject(sourceJob.outputStorageKey),
    );
    const editedPaths: string[] = [];
    for (const [index, segment] of job.editSegments.entries()) {
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
      const completed = await waitForProviderJob(submitted.job_id);
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
    return { video: await readFile(outputPath), providerJobIds };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function prepareFeishuVideo(video: Buffer): Promise<Buffer> {
  if (video.length <= FEISHU_VIDEO_MAX_BYTES) return video;

  const dir = await mkdtemp(join(tmpdir(), "media-hub-feishu-"));
  try {
    const inputPath = join(dir, "input.mp4");
    const outputPath = join(dir, "feishu.mp4");
    await writeFile(inputPath, video);
    const ffmpeg = process.env.FFMPEG_PATH ?? "ffmpeg";
    await execFileAsync(ffmpeg, [
      "-i",
      inputPath,
      "-vf",
      "scale=720:-2:force_original_aspect_ratio=decrease",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "30",
      "-maxrate",
      "2M",
      "-bufsize",
      "4M",
      "-c:a",
      "aac",
      "-b:a",
      "96k",
      "-movflags",
      "+faststart",
      outputPath,
      "-y",
      "-loglevel",
      "error",
    ]);
    const prepared = await readFile(outputPath);
    if (prepared.length > FEISHU_VIDEO_MAX_BYTES) {
      throw new Error("飞书通知视频压缩后仍超过 30 MB");
    }
    return prepared;
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
  const startedAt = new Date();
  const [job] = await db
    .update(mediaGenerationJob)
    .set({ status: "running", startedAt, updatedAt: startedAt })
    .where(
      and(
        eq(mediaGenerationJob.id, jobId),
        inArray(mediaGenerationJob.status, ["scheduled", "queued"]),
      ),
    )
    .returning();
  if (!job) return;

  const notifyResult = async (
    status: "succeeded" | "failed",
    finishedAt: Date,
    errorMessage?: string,
    video?: Buffer,
    providerJobId?: string,
  ) => {
    const creator = await db.query.user.findFirst({
      where: eq(User.id, job.createdBy),
      columns: { name: true, email: true },
    });
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
      videoUrl: appUrl ? `${appUrl}/#generation-job-${job.id}` : undefined,
      video,
    });
  };

  try {
    const providerHealth = await getMediaGenerationProviderHealth(true);
    if (providerHealth.status !== "healthy") {
      throw new Error(`H3 生成链路安全检查失败：${providerHealth.message}`);
    }
    let video: Buffer;
    let providerJobIds: string[];
    if (job.kind === "edit") {
      const result = await runVideoEditPipeline(job);
      video = result.video;
      providerJobIds = result.providerJobIds;
    } else {
      const submitted = await createProviderJob(job);
      providerJobIds = [submitted.job_id];
      await db
        .update(mediaGenerationJob)
        .set({
          providerJobId: submitted.job_id,
          providerJobIds,
          updatedAt: new Date(),
        })
        .where(eq(mediaGenerationJob.id, jobId));
      const completed = await waitForProviderJob(submitted.job_id);
      video = await joinVideoSamples(completed.samples ?? []);
    }
    const finishedAt = new Date();
    const outputStorageKey = `media-hub/${job.kind === "edit" ? "edited" : "generated"}/${job.createdBy}/${job.id}.mp4`;
    await putMediaHubObject(outputStorageKey, video, "video/mp4");
    const mediaTaskId = await createDraftFromGeneration(job, outputStorageKey);

    await db
      .update(mediaGenerationJob)
      .set({
        status: "succeeded",
        outputStorageKey,
        mediaTaskId,
        providerJobIds,
        finishedAt,
        updatedAt: finishedAt,
      })
      .where(eq(mediaGenerationJob.id, jobId));
    try {
      const feishuVideo = await prepareFeishuVideo(video);
      await notifyResult(
        "succeeded",
        finishedAt,
        undefined,
        feishuVideo,
        providerJobIds.join(", "),
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
    const errorMessage = (
      error instanceof Error ? error.message : String(error)
    ).slice(0, 1000);
    const finishedAt = new Date();
    await db
      .update(mediaGenerationJob)
      .set({
        status: "failed",
        errorMessage,
        finishedAt,
        updatedAt: finishedAt,
      })
      .where(eq(mediaGenerationJob.id, jobId));
    try {
      await notifyResult("failed", finishedAt, errorMessage);
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
      generationRunChain = generationRunChain
        .catch(() => undefined)
        .then(() => runGenerationJob(jobId));
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
        "running",
      ]),
      orderBy: desc(mediaGenerationJob.createdAt),
    })
    .then(async (jobs) => {
      for (const job of jobs) {
        if (job.status === "running") {
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
  await db
    .update(mediaGenerationJob)
    .set({ status: "canceled", finishedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(mediaGenerationJob.id, jobId),
        eq(mediaGenerationJob.status, job.status),
      ),
    );
}
