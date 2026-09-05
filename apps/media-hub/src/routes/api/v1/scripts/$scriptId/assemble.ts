import { createFileRoute } from "@tanstack/react-router";

import {
  agentJson,
  createAgentApiCaller,
  handleAgentApiError,
} from "~/lib/agent-api";

async function handlePost(
  request: Request,
  scriptId: string,
): Promise<Response> {
  try {
    const { caller } = await createAgentApiCaller(request);
    return agentJson(
      await caller.mediaHub.script.assemble({ id: scriptId }),
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
