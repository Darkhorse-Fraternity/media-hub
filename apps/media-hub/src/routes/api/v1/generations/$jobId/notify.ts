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
      await caller.mediaHub.generation.resendNotification({ id: jobId }),
    );
  } catch (error) {
    return handleAgentApiError(error);
  }
}

export const Route = createFileRoute("/api/v1/generations/$jobId/notify")({
  server: {
    handlers: {
      POST: ({ request, params }) => handlePost(request, params.jobId),
    },
  },
});
