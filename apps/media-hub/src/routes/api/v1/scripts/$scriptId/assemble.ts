import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod/v4";

import {
  AgentApiError,
  agentJson,
  createAgentApiCaller,
  handleAgentApiError,
} from "~/lib/agent-api";

const assembleBody = z.object({
  source_job_ids: z.array(z.string().uuid()).min(2).max(20).optional(),
  transition: z.enum(["cut", "fade_white", "fade_black"]).optional(),
  rebuild: z.boolean().optional(),
});

async function handlePost(
  request: Request,
  scriptId: string,
): Promise<Response> {
  try {
    const { caller } = await createAgentApiCaller(request);
    const rawBody = await request.text();
    let payload: unknown = {};
    if (rawBody.trim()) {
      try {
        payload = JSON.parse(rawBody);
      } catch {
        throw new AgentApiError(400, "Request body must be valid JSON");
      }
    }
    const body = assembleBody.parse(payload);
    return agentJson(
      await caller.mediaHub.script.assemble({
        id: scriptId,
        sourceJobIds: body.source_job_ids,
        transition: body.transition,
        rebuild: body.rebuild,
      }),
      201,
    );
  } catch (error) {
    return handleAgentApiError(error);
  }
}

export const Route = createFileRoute("/api/v1/scripts/$scriptId/assemble")({
  server: {
    handlers: {
      POST: ({ request, params }) => handlePost(request, params.scriptId),
    },
  },
});
