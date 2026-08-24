import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod/v4";

import {
  agentJson,
  createAgentApiCaller,
  handleAgentApiError,
  readAgentJson,
} from "~/lib/agent-api";

const editReferenceImage = z.object({
  storage_key: z.string().min(1),
  name: z.string().max(255),
  content_type: z.enum(["image/jpeg", "image/png", "image/webp"]),
  role: z.enum(["style", "subject"]),
});

const createVideoEditBody = z.object({
  title: z.string().trim().max(200).optional(),
  language: z.enum(["zh", "en"]).default("en"),
  scheduled_at: z.iso.datetime().nullable().optional(),
  segments: z
    .array(
      z.object({
        id: z.string().min(1).max(100),
        start_seconds: z.number().min(0).max(60),
        end_seconds: z.number().min(0).max(60),
        prompt: z.string().trim().min(1).max(5000),
        reference_images: z.array(editReferenceImage).max(4).default([]),
      }),
    )
    .min(1)
    .max(4),
});

async function handlePost(
  request: Request,
  sourceJobId: string,
): Promise<Response> {
  try {
    const { caller } = await createAgentApiCaller(request);
    const input = createVideoEditBody.parse(await readAgentJson(request));
    const result = await caller.mediaHub.generation.createEdit({
      sourceGenerationJobId: sourceJobId,
      title: input.title,
      language: input.language,
      scheduledAt: input.scheduled_at ? new Date(input.scheduled_at) : null,
      segments: input.segments.map((segment) => ({
        id: segment.id,
        startSeconds: segment.start_seconds,
        endSeconds: segment.end_seconds,
        prompt: segment.prompt,
        preserveSourceAudio: true,
        referenceImages: segment.reference_images.map((image) => ({
          storageKey: image.storage_key,
          name: image.name,
          contentType: image.content_type,
          role: image.role,
        })),
      })),
    });
    return agentJson(result, 201);
  } catch (error) {
    return handleAgentApiError(error);
  }
}

export const Route = createFileRoute("/api/v1/generations/$jobId/edits")({
  server: {
    handlers: {
      POST: ({ request, params }) => handlePost(request, params.jobId),
    },
  },
});
