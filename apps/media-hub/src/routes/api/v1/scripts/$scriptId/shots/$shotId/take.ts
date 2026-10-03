import { createFileRoute } from "@tanstack/react-router";

import {
  agentJson,
  createAgentApiCaller,
  handleAgentApiError,
  readAgentJson,
} from "~/lib/agent-api";
import { selectScriptTakeBody } from "~/lib/agent-video-script";

export async function handlePatch(
  request: Request,
  scriptId: string,
  shotId: string,
): Promise<Response> {
  try {
    const { caller } = await createAgentApiCaller(request);
    const body = selectScriptTakeBody.parse(await readAgentJson(request));
    return agentJson(
      await caller.mediaHub.script.selectTake({
        id: scriptId,
        shotId,
        jobId: body.job_id,
        version: body.version,
      }),
    );
  } catch (error) {
    return handleAgentApiError(error);
  }
}

export const Route = createFileRoute(
  "/api/v1/scripts/$scriptId/shots/$shotId/take",
)({
  server: {
    handlers: {
      PATCH: ({ request, params }) =>
        handlePatch(request, params.scriptId, params.shotId),
    },
  },
});
