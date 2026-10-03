import { createFileRoute } from "@tanstack/react-router";

import {
  agentJson,
  createAgentApiCaller,
  handleAgentApiError,
  readAgentJson,
} from "~/lib/agent-api";
import { scriptCaptionGenerateBody } from "~/lib/agent-video-script";

export async function handlePost(
  request: Request,
  scriptId: string,
  shotId: string,
): Promise<Response> {
  try {
    const { caller } = await createAgentApiCaller(request);
    const body = scriptCaptionGenerateBody.parse(await readAgentJson(request));
    return agentJson(
      await caller.mediaHub.script.generateCaptions({
        id: scriptId,
        shotId,
        version: body.version,
      }),
    );
  } catch (error) {
    return handleAgentApiError(error);
  }
}

export const Route = createFileRoute(
  "/api/v1/scripts/$scriptId/shots/$shotId/captions/generate",
)({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        handlePost(request, params.scriptId, params.shotId),
    },
  },
});
