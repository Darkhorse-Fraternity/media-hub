import { createFileRoute } from "@tanstack/react-router";

import {
  agentJson,
  createAgentApiCaller,
  handleAgentApiError,
  readAgentJson,
} from "~/lib/agent-api";
import { selectScriptFrameCandidateBody } from "~/lib/agent-video-script";

async function handlePatch(request: Request, scriptId: string, shotId: string) {
  try {
    const { caller } = await createAgentApiCaller(request);
    const input = selectScriptFrameCandidateBody.parse(
      await readAgentJson(request),
    );
    return agentJson(
      await caller.mediaHub.script.selectFrameCandidate({
        id: scriptId,
        shotId,
        assetId: input.asset_id,
        version: input.version,
      }),
    );
  } catch (error) {
    return handleAgentApiError(error);
  }
}

export const Route = createFileRoute(
  "/api/v1/scripts/$scriptId/shots/$shotId/frames/select",
)({
  server: {
    handlers: {
      PATCH: ({ request, params }) =>
        handlePatch(request, params.scriptId, params.shotId),
    },
  },
});
