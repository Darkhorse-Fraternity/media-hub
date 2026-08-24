import { createHash } from "node:crypto";

import { and, asc, desc, eq, inArray } from "@acme/db";
import { db } from "@acme/db/client";
import {
  mediaImageAsset,
  mediaImageJob,
  mediaImageJobInput,
} from "@acme/db/schema";
import { log } from "@acme/logger";
import {
  deleteMediaHubObject,
  getMediaHubObject,
  putMediaHubObject,
} from "@acme/storage";

import { imageFramingPrompt, imageVariationPrompt } from "./image-prompt";
import {
  checksumProviderValue,
  providerOrchestrationRunId,
} from "./provider-contract";
import { requestGenerationProvider } from "./provider-request";

export const HIDREAM_IMAGE_PROFILE = "platform-hidream-o1-image-v1";
const PROVIDER_CONTRACT = "ydc_generated_media_provider_request.v1";
const MAX_IMAGE_OUTPUT_BYTES = 25_000_000;
const IMAGE_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

interface ProviderSample {
  sample_id?: string;
  content_base64?: string;
  content_type?: string;
  filename?: string;
}

interface ProviderJob {
  job_id: string;
  status: string;
  error_message?: string;
  model_version?: string;
  workflow_version?: string;
  samples?: ProviderSample[];
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();
let recoveryStarted = false;
let imageRunChain: Promise<void> = Promise.resolve();

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
): Promise<T> {
  const { baseUrl, token } = providerConfig();
  return requestGenerationProvider<T>({
    baseUrl,
    token,
    path,
    init,
    timeoutMs: 20_000,
    maxAttempts: 3,
  });
}

function checksumBytes(value: Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function contentTypeExtension(contentType: string): string {
  if (contentType === "image/jpeg") return "jpg";
  if (contentType === "image/webp") return "webp";
  return "png";
}

async function createProviderJob(job: typeof mediaImageJob.$inferSelect) {
  const inputRows = await db
    .select({
      position: mediaImageJobInput.position,
      filename: mediaImageAsset.filename,
      contentType: mediaImageAsset.contentType,
      storageKey: mediaImageAsset.storageKey,
    })
    .from(mediaImageJobInput)
    .innerJoin(
      mediaImageAsset,
      eq(mediaImageJobInput.assetId, mediaImageAsset.id),
    )
    .where(eq(mediaImageJobInput.jobId, job.id))
    .orderBy(asc(mediaImageJobInput.position));

  const sourceArtifacts = await Promise.all(
    inputRows.map(async (input) => {
      const content = await getMediaHubObject(input.storageKey);
      return {
        name: input.filename,
        content_type: input.contentType,
        checksum: checksumBytes(content),
        contract: "generated_media_source.v1",
        role: "reference",
        content_base64: content.toString("base64"),
      };
    }),
  );
  const generationSpec = {
    profile: HIDREAM_IMAGE_PROFILE,
    parameters: {
      behavior_prompts: {
        main: imageVariationPrompt(
          imageFramingPrompt(job.prompt, job.width, job.height),
          job.outputCount,
          job.diversity,
        ),
      },
      negative_prompt: job.negativePrompt,
      width: job.width,
      height: job.height,
      steps: 20,
      cfg: 5,
      ...(job.seed === null ? {} : { seed: job.seed }),
    },
  };
  return providerRequest<ProviderJob>("/v1/generated-media/jobs", {
    method: "POST",
    body: JSON.stringify({
      schema_version: PROVIDER_CONTRACT,
      orchestration_run_id: providerOrchestrationRunId(
        job.id,
        job.startedAt ?? job.createdAt,
      ),
      project_id: "pumpkii-media-hub",
      attempt: 1,
      deficits: { main: job.outputCount },
      max_outputs: job.outputCount,
      generation_spec: generationSpec,
      generation_spec_checksum: checksumProviderValue(generationSpec),
      source_artifacts: sourceArtifacts,
    }),
  });
}

async function waitForProviderJob(providerJobId: string): Promise<ProviderJob> {
  const deadline = Date.now() + 60 * 60 * 1000;
  while (Date.now() < deadline) {
    const current = await providerRequest<ProviderJob>(
      `/v1/generated-media/jobs/${encodeURIComponent(providerJobId)}`,
    );
    if (current.status === "succeeded") return current;
    if (current.status === "failed" || current.status === "canceled") {
      throw new Error(current.error_message ?? `图片生成任务${current.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error("HiDream 图片生成超时");
}

async function runImageJob(jobId: string): Promise<void> {
  const startedAt = new Date();
  const [job] = await db
    .update(mediaImageJob)
    .set({
      status: "running",
      startedAt,
      errorMessage: null,
      updatedAt: startedAt,
    })
    .where(and(eq(mediaImageJob.id, jobId), eq(mediaImageJob.status, "queued")))
    .returning();
  if (!job) return;

  const outputStorageKeys: string[] = [];
  try {
    const submitted = await createProviderJob(job);
    await db
      .update(mediaImageJob)
      .set({ providerJobId: submitted.job_id, updatedAt: new Date() })
      .where(eq(mediaImageJob.id, job.id));
    const completed = await waitForProviderJob(submitted.job_id);
    const latest = await db.query.mediaImageJob.findFirst({
      where: eq(mediaImageJob.id, job.id),
      columns: { status: true },
    });
    if (latest?.status === "canceled") return;
    const samples = completed.samples ?? [];
    if (samples.length < job.outputCount) {
      throw new Error(
        `HiDream Provider 仅返回 ${samples.length}/${job.outputCount} 张图片`,
      );
    }
    const outputAssets: (typeof mediaImageAsset.$inferInsert)[] = [];
    for (const sample of samples.slice(0, job.outputCount)) {
      const contentType = sample.content_type ?? "";
      if (!sample.content_base64 || !IMAGE_CONTENT_TYPES.has(contentType)) {
        throw new Error("HiDream Provider 未返回有效图片");
      }
      const content = Buffer.from(sample.content_base64, "base64");
      if (content.length <= 0 || content.length > MAX_IMAGE_OUTPUT_BYTES) {
        throw new Error("HiDream Provider 返回的图片大小无效");
      }
      const assetId = crypto.randomUUID();
      const extension = contentTypeExtension(contentType);
      const storageKey = `media-hub/image/${job.createdBy}/${assetId}.${extension}`;
      await putMediaHubObject(storageKey, content, contentType);
      outputStorageKeys.push(storageKey);
      outputAssets.push({
        id: assetId,
        jobId: job.id,
        storageKey,
        filename: sample.filename?.trim() ?? `${assetId}.${extension}`,
        contentType,
        width: job.width,
        height: job.height,
        sizeBytes: content.length,
        checksum: checksumBytes(content),
        origin: "generated",
        ownerUserId: job.createdBy,
      });
    }
    const finishedAt = new Date();
    await db.transaction(async (tx) => {
      await tx
        .insert(mediaImageAsset)
        .values(
          outputAssets.map((asset) => ({ ...asset, createdAt: finishedAt })),
        );
      await tx
        .update(mediaImageJob)
        .set({
          status: "succeeded",
          workflowVersion: completed.workflow_version ?? null,
          modelVersion: completed.model_version ?? null,
          finishedAt,
          updatedAt: finishedAt,
        })
        .where(eq(mediaImageJob.id, job.id));
    });
  } catch (error) {
    await Promise.all(
      outputStorageKeys.map((storageKey) =>
        deleteMediaHubObject(storageKey).catch(() => undefined),
      ),
    );
    const latest = await db.query.mediaImageJob.findFirst({
      where: eq(mediaImageJob.id, job.id),
      columns: { status: true },
    });
    if (latest?.status === "canceled") return;
    const finishedAt = new Date();
    const errorMessage = (
      error instanceof Error ? error.message : String(error)
    ).slice(0, 1000);
    await db
      .update(mediaImageJob)
      .set({
        status: "failed",
        errorMessage,
        finishedAt,
        updatedAt: finishedAt,
      })
      .where(eq(mediaImageJob.id, job.id));
    log.error("HiDream image generation failed", {
      code: "MEDIA_IMAGE_GENERATION_FAILED",
      job_id: job.id,
      err: error instanceof Error ? error : new Error(String(error)),
    });
  }
}

export function scheduleMediaImageJob(jobId: string): void {
  if (timers.has(jobId)) return;
  const timer = setTimeout(() => {
    if (timers.get(jobId) === timer) timers.delete(jobId);
    imageRunChain = imageRunChain
      .catch(() => undefined)
      .then(() => runImageJob(jobId));
  }, 0);
  timers.set(jobId, timer);
}

export function startMediaImageScheduler(): void {
  if (recoveryStarted) return;
  recoveryStarted = true;
  void db.query.mediaImageJob
    .findMany({
      where: inArray(mediaImageJob.status, ["queued", "running"]),
      orderBy: desc(mediaImageJob.createdAt),
    })
    .then(async (jobs) => {
      for (const job of jobs) {
        if (job.status === "running") {
          await db
            .update(mediaImageJob)
            .set({ status: "queued", updatedAt: new Date() })
            .where(eq(mediaImageJob.id, job.id));
        }
        scheduleMediaImageJob(job.id);
      }
    })
    .catch(() => {
      recoveryStarted = false;
    });
}

export async function cancelMediaImageJob(jobId: string): Promise<void> {
  const job = await db.query.mediaImageJob.findFirst({
    where: eq(mediaImageJob.id, jobId),
  });
  if (!job || ["succeeded", "failed", "canceled"].includes(job.status)) return;
  const timer = timers.get(jobId);
  if (timer) clearTimeout(timer);
  timers.delete(jobId);
  if (job.providerJobId) {
    await providerRequest(
      `/v1/generated-media/jobs/${encodeURIComponent(job.providerJobId)}:cancel`,
      { method: "POST", body: "{}" },
    ).catch(() => undefined);
  }
  await db
    .update(mediaImageJob)
    .set({ status: "canceled", finishedAt: new Date(), updatedAt: new Date() })
    .where(eq(mediaImageJob.id, job.id));
}

export async function getMediaImageProviderHealth() {
  const health = await providerRequest<{
    status?: string;
    profiles?: string[];
    provider_version?: string;
  }>("/healthz");
  return {
    status:
      health.status === "healthy" &&
      health.profiles?.includes(HIDREAM_IMAGE_PROFILE)
        ? ("healthy" as const)
        : ("misconfigured" as const),
    providerVersion: health.provider_version ?? null,
    profile: HIDREAM_IMAGE_PROFILE,
  };
}
