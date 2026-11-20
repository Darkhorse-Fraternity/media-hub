import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod/v4";

import {
  MEDIA_H3_DEFAULT_DURATION_SECONDS,
  MEDIA_H3_DEFAULT_HEIGHT,
  MEDIA_H3_DEFAULT_QUALITY_PRESET,
  MEDIA_H3_DEFAULT_WIDTH,
  MEDIA_H3_PROMPT_MAX_LENGTH,
  mediaH3DimensionSchema,
  mediaH3ReferenceVideoSchema,
} from "@acme/validators";

import {
  agentJson,
  createAgentApiCaller,
  handleAgentApiError,
  readAgentJson,
} from "~/lib/agent-api";

const createGenerationBody = z.object({
  prompt: z.string().trim().min(1).max(MEDIA_H3_PROMPT_MAX_LENGTH),
  language: z.enum(["zh", "en"]).default("en"),
  generation_mode: z.enum(["base", "reference"]).default("base"),
  reference_artifact_id: z.string().uuid().optional(),
  reference_video: z
    .object({
      storage_key: z.string().min(1),
      name: z.string().min(1).max(255),
      content_type: z.literal("video/mp4"),
    })
    .optional(),
  title: z.string().trim().max(200).optional(),
  duration_seconds: z
    .number()
    .int()
    .min(5)
    .max(60)
    .default(MEDIA_H3_DEFAULT_DURATION_SECONDS),
  quality_preset: z
    .enum(["fast", "balanced", "quality"])
    .default(MEDIA_H3_DEFAULT_QUALITY_PRESET),
  generation_profile: z.string().trim().min(1).max(200).optional(),
  seed: z.number().int().min(0).max(2_147_483_643).optional(),
  scheduled_at: z.iso.datetime().nullable().optional(),
  width: mediaH3DimensionSchema.default(MEDIA_H3_DEFAULT_WIDTH),
  height: mediaH3DimensionSchema.default(MEDIA_H3_DEFAULT_HEIGHT),
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
  reference_audio: z
    .array(
      z.object({
        storage_key: z.string().min(1),
        name: z.string().max(255),
        content_type: z.enum([
          "audio/aac",
          "audio/mp4",
          "audio/mpeg",
          "audio/wav",
          "audio/x-wav",
        ]),
      }),
    )
    .max(4)
    .default([]),
  dialogues: z
    .array(
      z.object({
        segment: z.number().int().min(1).max(4),
        speaker_id: z.enum(["S1", "S2", "S3", "S4"]),
        language: z.enum(["zh", "en"]),
        text: z.string().trim().min(1).max(300),
        voice: z.string().trim().min(1).max(500).optional(),
        delivery: z
          .enum(["on_screen", "off_screen_voiceover"])
          .default("on_screen"),
      }),
    )
    .max(12)
    .default([]),
});

export async function handleGet(request: Request): Promise<Response> {
  try {
    const { caller } = await createAgentApiCaller(request);
    const url = new URL(request.url);
    const page = Number(url.searchParams.get("page") ?? "1");
    const pageSize = Number(url.searchParams.get("page_size") ?? "20");
    const wholeVideosOnly =
      url.searchParams.get("whole_videos_only") === "true";
    const rawStatus = url.searchParams.get("status") ?? undefined;
    const status = z
      .enum([
        "scheduled",
        "queued",
        "waiting_for_gpu",
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
      wholeVideosOnly,
    });
    return agentJson(result);
  } catch (error) {
    return handleAgentApiError(error);
  }
}

export async function handlePost(request: Request): Promise<Response> {
  try {
    const { caller } = await createAgentApiCaller(request);
    const input = createGenerationBody.parse(await readAgentJson(request));
    const result = await caller.mediaHub.generation.create({
      prompt: input.prompt,
      language: input.language,
      generationMode: input.generation_mode,
      referenceArtifactId: input.reference_artifact_id,
      referenceVideo: input.reference_video
        ? mediaH3ReferenceVideoSchema.parse({
            storageKey: input.reference_video.storage_key,
            name: input.reference_video.name,
            contentType: input.reference_video.content_type,
          })
        : undefined,
      title: input.title,
      durationSeconds: input.duration_seconds,
      qualityPreset: input.quality_preset,
      h3Profile: input.generation_profile,
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
      referenceAudios: input.reference_audio.map((audio) => ({
        storageKey: audio.storage_key,
        name: audio.name,
        contentType: audio.content_type,
      })),
      dialogues: input.dialogues.map((dialogue) => ({
        segment: dialogue.segment,
        speakerId: dialogue.speaker_id,
        language: dialogue.language,
        text: dialogue.text,
        voice: dialogue.voice,
        delivery: dialogue.delivery,
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
