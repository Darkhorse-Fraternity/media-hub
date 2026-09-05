import { createFileRoute } from "@tanstack/react-router";

import {
  agentJson,
  createAgentApiCaller,
  handleAgentApiError,
  readAgentJson,
} from "~/lib/agent-api";
import { generateScriptBody } from "~/lib/agent-video-script";

async function handlePost(
  request: Request,
  scriptId: string,
): Promise<Response> {
  try {
    const { caller } = await createAgentApiCaller(request);
    const input = generateScriptBody.parse(await readAgentJson(request));
    return agentJson(
      await caller.mediaHub.script.generate({
        id: scriptId,
        shotIds: input.shot_ids,
        qualityPreset: input.quality_preset,
        h3Profile: input.generation_profile,
      }),
      201,
    );
  } catch (error) {
    return handleAgentApiError(error);
  }
}

export const Route = createFileRoute("/api/v1/scripts/$scriptId/generate")({
  server: {
    handlers: {
      POST: ({ request, params }) => handlePost(request, params.scriptId),
    },
  },
});
