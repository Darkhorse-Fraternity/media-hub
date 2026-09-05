import { createFileRoute } from "@tanstack/react-router";

import {
  agentJson,
  createAgentApiCaller,
  handleAgentApiError,
  readAgentJson,
} from "~/lib/agent-api";
import { draftScriptBody } from "~/lib/agent-video-script";

async function handlePost(request: Request): Promise<Response> {
  try {
    const { caller } = await createAgentApiCaller(request);
    const input = draftScriptBody.parse(await readAgentJson(request));
    return agentJson(
      await caller.mediaHub.script.draft({
        title: input.title,
        brief: input.brief,
        language: input.language,
        targetDurationSeconds: input.target_duration_seconds,
        shotCount: input.shot_count,
      }),
    );
  } catch (error) {
    return handleAgentApiError(error);
  }
}

export const Route = createFileRoute("/api/v1/scripts/draft")({
  server: { handlers: { POST: ({ request }) => handlePost(request) } },
});
