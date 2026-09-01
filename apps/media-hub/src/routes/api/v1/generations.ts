import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod/v4";

import { mediaH3DimensionSchema } from "@acme/validators";

import {
  agentJson,
  createAgentApiCaller,
  handleAgentApiError,
  readAgentJson,
} from "~/lib/agent-api";

const createGenerationBody = z.object({
  prompt: z.string().trim().min(1).max(16000),
  language: z.enum(["zh", "en"]).default("en"),
  title: z.string().trim().max(200).optional(),
  duration_seconds: z.number().int().min(5).max(60).default(30),
  quality_preset: z.enum(["fast", "balanced", "quality"]).default("balanced"),
  seed: z.number().int().min(0).max(2_147_483_643).optional(),
  scheduled_at: z.iso.datetime().nullable().optional(),
  width: mediaH3DimensionSchema.default(1344),
  height: mediaH3DimensionSchema.default(768),
  first_frame: z
    .object({
      storage_key: z.string().min(1),
      name: z.string().max(255),
      content_type: z.enum(["image/jpeg", "image/png", "image/webp"]),
    })
    .nullable()
    .optional(),
  reference_images: z
    .array(
      z.object({
        storage_key: z.string().min(1),
        name: z.string().max(255),
        content_type: z.enum(["image/jpeg", "image/png", "image/webp"]),
        role: z.enum(["style", "subject"]),
      }),
    )
    .max(4)
    .default([]),
});

async function handleGet(request: Request): Promise<Response> {
  try {
    const { caller } = await createAgentApiCaller(request);
    const url = new URL(request.url);
    const page = Number(url.searchParams.get("page") ?? "1");
    const pageSize = Number(url.searchParams.get("page_size") ?? "20");
    const rawStatus = url.searchParams.get("status") ?? undefined;
    const status = z
      .enum([
        "scheduled",
        "queued",
        "running",
        "succeeded",
        "failed",
        "canceled",
      ])
      .optional()
      .parse(rawStatus);
    const result = await caller.mediaHub.generation.list({
      page,
      pageSize,
      status,
    });
    return agentJson(result);
  } catch (error) {
    return handleAgentApiError(error);
  }
}

async function handlePost(request: Request): Promise<Response> {
  try {
    const { caller } = await createAgentApiCaller(request);
    const input = createGenerationBody.parse(await readAgentJson(request));
    const result = await caller.mediaHub.generation.create({
      prompt: input.prompt,
      language: input.language,
      title: input.title,
      durationSeconds: input.duration_seconds,
      qualityPreset: input.quality_preset,
      seed: input.seed,
      scheduledAt: input.scheduled_at ? new Date(input.scheduled_at) : null,
      width: input.width,
      height: input.height,
      sourceImageStorageKey: input.first_frame?.storage_key,
      sourceImageName: input.first_frame?.name,
      sourceImageContentType: input.first_frame?.content_type,
      referenceImages: input.reference_images.map((image) => ({
        storageKey: image.storage_key,
        name: image.name,
        contentType: image.content_type,
        role: image.role,
      })),
    });
    return agentJson(result, 201);
  } catch (error) {
    return handleAgentApiError(error);
  }
}

export const Route = createFileRoute("/api/v1/generations")({
  server: {
    handlers: {
      GET: ({ request }) => handleGet(request),
      POST: ({ request }) => handlePost(request),
    },
  },
});
