import { createFileRoute } from "@tanstack/react-router";

import {
  agentJson,
  createAgentApiCaller,
  handleAgentApiError,
} from "~/lib/agent-api";

async function handleGet(request: Request): Promise<Response> {
  try {
    const { caller } = await createAgentApiCaller(request);
    const health = await caller.mediaHub.generation.providerHealth();
    return agentJson({
      status: health.status,
      default_generation_profile: health.defaultGenerationProfile,
      profiles: health.profiles.filter(
        (profile) => profile.kind === "generate",
      ),
    });
  } catch (error) {
    return handleAgentApiError(error);
  }
}

export const Route = createFileRoute("/api/v1/generation-profiles")({
  server: { handlers: { GET: ({ request }) => handleGet(request) } },
});
