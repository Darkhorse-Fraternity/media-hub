import { createFileRoute } from "@tanstack/react-router";

import {
  agentJson,
  createAgentApiCaller,
  handleAgentApiError,
  readAgentJson,
} from "~/lib/agent-api";
import { createScriptFrameCandidatesBody } from "~/lib/agent-video-script";

async function handleGet(request: Request, scriptId: string, shotId: string) {
  try {
    const { caller } = await createAgentApiCaller(request);
    return agentJson(
      await caller.mediaHub.script.listFrameCandidates({
        id: scriptId,
        shotId,
      }),
    );
  } catch (error) {
    return handleAgentApiError(error);
  }
}

async function handlePost(request: Request, scriptId: string, shotId: string) {
  try {
    const { caller } = await createAgentApiCaller(request);
    const input = createScriptFrameCandidatesBody.parse(
      await readAgentJson(request),
    );
    return agentJson(
      await caller.mediaHub.script.createFrameCandidates({
        id: scriptId,
        shotId,
        outputCount: input.output_count,
      }),
      201,
    );
  } catch (error) {
    return handleAgentApiError(error);
  }
}

export const Route = createFileRoute(
  "/api/v1/scripts/$scriptId/shots/$shotId/frames",
)({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        handleGet(request, params.scriptId, params.shotId),
      POST: ({ request, params }) =>
        handlePost(request, params.scriptId, params.shotId),
    },
  },
});
