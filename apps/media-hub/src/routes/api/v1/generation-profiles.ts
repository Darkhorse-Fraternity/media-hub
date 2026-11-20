import { createFileRoute } from "@tanstack/react-router";

import {
  MEDIA_H3_REFERENCE_VIDEO_FPS,
  MEDIA_H3_REFERENCE_VIDEO_MAX_BYTES,
  MEDIA_H3_REFERENCE_VIDEO_MAX_FRAMES,
  MEDIA_H3_REFERENCE_VIDEO_MIN_FRAMES,
} from "@acme/validators";

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
        max_size_bytes: MEDIA_H3_REFERENCE_VIDEO_MAX_BYTES,
        fps: MEDIA_H3_REFERENCE_VIDEO_FPS,
        min_duration_seconds:
          MEDIA_H3_REFERENCE_VIDEO_MIN_FRAMES / MEDIA_H3_REFERENCE_VIDEO_FPS,
        max_duration_seconds:
          MEDIA_H3_REFERENCE_VIDEO_MAX_FRAMES / MEDIA_H3_REFERENCE_VIDEO_FPS,
        min_output_duration_seconds: 5,
        max_output_duration_seconds: 15,
        frame_grid: "17n+5",
        min_frames: MEDIA_H3_REFERENCE_VIDEO_MIN_FRAMES,
        max_frames: MEDIA_H3_REFERENCE_VIDEO_MAX_FRAMES,
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
