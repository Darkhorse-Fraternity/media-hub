import { createFileRoute } from "@tanstack/react-router";

import {
  agentJson,
  createAgentApiCaller,
  handleAgentApiError,
  readOptionalAgentJson,
} from "~/lib/agent-api";
import { assembleScriptBody } from "~/lib/agent-video-script";

async function handlePost(
  request: Request,
  scriptId: string,
): Promise<Response> {
  try {
    const { caller } = await createAgentApiCaller(request);
    const body = assembleScriptBody.parse(await readOptionalAgentJson(request));
    return agentJson(
      await caller.mediaHub.script.assemble({
        id: scriptId,
        burnCaptions: body.burn_captions,
        sourceJobIds: body.source_job_ids,
        transition: body.transition,
        rebuild: body.rebuild,
      }),
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
