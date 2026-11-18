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
      default_reference_generation_profile:
        health.defaultReferenceGenerationProfile,
      reference_video_constraints: {
        max_videos: 1,
        max_images: 4,
        max_size_bytes: 50_000_000,
        fps: 24,
        min_duration_seconds: 5,
        max_duration_seconds: 15,
        frame_grid: "17n+5",
        max_frames: 362,
        preserve_source_audio: false,
      },
      profiles: health.profiles.filter(
        (profile) =>
          profile.kind === "generate" || profile.supportsReferenceVideo,
      ),
    });
  } catch (error) {
    return handleAgentApiError(error);
  }
}

export const Route = createFileRoute("/api/v1/generation-profiles")({
  server: { handlers: { GET: ({ request }) => handleGet(request) } },
});
