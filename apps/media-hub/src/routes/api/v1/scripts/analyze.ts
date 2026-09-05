import { createFileRoute } from "@tanstack/react-router";

import {
  agentJson,
  createAgentApiCaller,
  handleAgentApiError,
  readAgentJson,
} from "~/lib/agent-api";
import { analyzeScriptBody, mapScriptShots } from "~/lib/agent-video-script";

async function handlePost(request: Request): Promise<Response> {
  try {
    const { caller } = await createAgentApiCaller(request);
    const input = analyzeScriptBody.parse(await readAgentJson(request));
    return agentJson(
      await caller.mediaHub.script.analyze({
        shots: mapScriptShots(input.shots),
      }),
    );
  } catch (error) {
    return handleAgentApiError(error);
  }
}

export const Route = createFileRoute("/api/v1/scripts/analyze")({
  server: { handlers: { POST: ({ request }) => handlePost(request) } },
});
