import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod/v4";

import {
  agentJson,
  createAgentApiCaller,
  handleAgentApiError,
  readAgentJson,
} from "~/lib/agent-api";

const updateGenerationBody = z.object({
  prompt: z.string().trim().min(1).max(5000).optional(),
  language: z.enum(["zh", "en"]).optional(),
  title: z.string().trim().max(200).nullable().optional(),
  duration_seconds: z.number().int().min(5).max(60).optional(),
  scheduled_at: z.iso.datetime().nullable().optional(),
});

async function handleGet(request: Request, jobId: string): Promise<Response> {
  try {
    const { caller } = await createAgentApiCaller(request);
    return agentJson(await caller.mediaHub.generation.getById({ id: jobId }));
  } catch (error) {
    return handleAgentApiError(error);
  }
}

async function handlePatch(request: Request, jobId: string): Promise<Response> {
  try {
    const { caller } = await createAgentApiCaller(request);
    const patch = updateGenerationBody.parse(await readAgentJson(request));
    const current = await caller.mediaHub.generation.getById({ id: jobId });
    const result = await caller.mediaHub.generation.update({
      id: jobId,
      prompt: patch.prompt ?? current.prompt,
      language: patch.language ?? (current.language === "en" ? "en" : "zh"),
      title: patch.title === undefined ? current.title : patch.title,
      durationSeconds: patch.duration_seconds ?? current.durationSeconds,
      scheduledAt:
        patch.scheduled_at === undefined
          ? current.scheduledAt
          : patch.scheduled_at
            ? new Date(patch.scheduled_at)
            : null,
    });
    return agentJson(result);
  } catch (error) {
    return handleAgentApiError(error);
  }
}

async function handleDelete(
  request: Request,
  jobId: string,
): Promise<Response> {
  try {
    const { caller } = await createAgentApiCaller(request);
    const job = await caller.mediaHub.generation.getById({ id: jobId });
    const result = ["scheduled", "queued", "running"].includes(job.status)
      ? await caller.mediaHub.generation.cancel({ id: jobId })
      : await caller.mediaHub.generation.remove({ id: jobId });
    return agentJson(result);
  } catch (error) {
    return handleAgentApiError(error);
  }
}

export const Route = createFileRoute("/api/v1/generations/$jobId")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleGet(request, params.jobId),
      PATCH: ({ request, params }) => handlePatch(request, params.jobId),
      DELETE: ({ request, params }) => handleDelete(request, params.jobId),
    },
  },
});
