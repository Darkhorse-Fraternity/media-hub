import { createFileRoute } from "@tanstack/react-router";

import {
  agentJson,
  createAgentApiCaller,
  handleAgentApiError,
  readAgentJson,
} from "~/lib/agent-api";
import { bridgeScriptFrameBody } from "~/lib/agent-video-script";

async function handlePost(
  request: Request,
  scriptId: string,
  shotId: string,
): Promise<Response> {
  try {
    const { caller } = await createAgentApiCaller(request);
    const input = bridgeScriptFrameBody.parse(await readAgentJson(request));
    return agentJson(
      await caller.mediaHub.script.bridgeLastFrame({
        id: scriptId,
        sourceShotId: shotId,
        version: input.version,
      }),
      201,
    );
  } catch (error) {
    return handleAgentApiError(error);
  }
}

export const Route = createFileRoute(
  "/api/v1/scripts/$scriptId/shots/$shotId/carry-final-frame",
)({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        handlePost(request, params.scriptId, params.shotId),
    },
  },
});
