import { createFileRoute } from "@tanstack/react-router";

import {
  agentJson,
  createAgentApiCaller,
  handleAgentApiError,
  readAgentJson,
} from "~/lib/agent-api";
import { mapShotCaptions, scriptShotEditBody } from "~/lib/agent-video-script";

export async function handlePatch(
  request: Request,
  scriptId: string,
  shotId: string,
): Promise<Response> {
  try {
    const { caller } = await createAgentApiCaller(request);
    const body = scriptShotEditBody.parse(await readAgentJson(request));
    return agentJson(
      await caller.mediaHub.script.updateShotEdit({
        id: scriptId,
        shotId,
        version: body.version,
        trimStartSeconds: body.trim_start_seconds,
        trimEndSeconds: body.trim_end_seconds,
        captions: body.captions ? mapShotCaptions(body.captions) : undefined,
      }),
    );
  } catch (error) {
    return handleAgentApiError(error);
  }
}

export const Route = createFileRoute(
  "/api/v1/scripts/$scriptId/shots/$shotId/edit-plan",
)({
  server: {
    handlers: {
      PATCH: ({ request, params }) =>
        handlePatch(request, params.scriptId, params.shotId),
    },
  },
});
