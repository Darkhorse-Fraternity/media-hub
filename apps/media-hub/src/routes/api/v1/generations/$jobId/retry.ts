import { createFileRoute } from "@tanstack/react-router";

import {
  agentJson,
  createAgentApiCaller,
  handleAgentApiError,
} from "~/lib/agent-api";

async function handlePost(request: Request, jobId: string): Promise<Response> {
  try {
    const { caller } = await createAgentApiCaller(request);
    return agentJson(
      await caller.mediaHub.generation.retry({ id: jobId }),
      202,
    );
  } catch (error) {
    return handleAgentApiError(error);
  }
}

export const Route = createFileRoute("/api/v1/generations/$jobId/retry")({
  server: {
    handlers: {
      POST: ({ request, params }) => handlePost(request, params.jobId),
    },
  },
});
