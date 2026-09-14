import { createFileRoute } from "@tanstack/react-router";

import {
  agentJson,
  createAgentApiCaller,
  handleAgentApiError,
} from "~/lib/agent-api";

async function handlePost(request: Request, jobId: string): Promise<Response> {
  try {
    const { caller } = await createAgentApiCaller(request);
    const result = await caller.mediaHub.generation.prepareXiaohongshuPackage({
      id: jobId,
    });
    return agentJson(result);
  } catch (error) {
    return handleAgentApiError(error);
  }
}

export const Route = createFileRoute(
  "/api/v1/generations/$jobId/xiaohongshu-package",
)({
  server: {
    handlers: {
      POST: ({ request, params }) => handlePost(request, params.jobId),
    },
  },
});
