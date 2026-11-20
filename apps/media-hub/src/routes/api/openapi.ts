import { createFileRoute } from "@tanstack/react-router";

import {
  MEDIA_H3_DEFAULT_DURATION_SECONDS,
  MEDIA_H3_DEFAULT_HEIGHT,
  MEDIA_H3_DEFAULT_QUALITY_PRESET,
  MEDIA_H3_DEFAULT_WIDTH,
  MEDIA_H3_PROMPT_MAX_LENGTH,
  MEDIA_H3_REFERENCE_VIDEO_MAX_FRAMES,
  MEDIA_H3_REFERENCE_VIDEO_MIN_FRAMES,
  MEDIA_H3_SCRIPT_SHOT_SECONDS,
  MEDIA_H3_SCRIPT_TARGET_DURATIONS,
} from "@acme/validators";

import { env } from "~/env";
import { previsOpenApiPaths, previsOpenApiSchemas } from "~/lib/previs-openapi";
import {
  previsRenderOpenApiPaths,
  previsRenderOpenApiSchemas,
} from "~/lib/previs-render-openapi";

function openApiDocument(request: Request) {
  const publicUrl = env.MEDIA_HUB_AGENT_PUBLIC_URL?.trim();
  const origin = new URL(publicUrl?.length ? publicUrl : request.url).origin;
  const bearerSecurity = [{ bearerAuth: [] }];
  const errorResponses = {
    "400": { description: "Invalid request" },
    "401": { description: "Invalid or missing Bearer token" },
    "403": { description: "Insufficient permission" },
    "404": { description: "Resource not found" },
    "409": { description: "Operation conflicts with current state" },
    "412": { description: "Required workflow step is not complete" },
    "429": { description: "Too many requests" },
  };
  return {
    openapi: "3.1.0",
    info: {
      title: "Pumpkii Media Hub Agent API",
      version: "1.12.0",
      description:
        "Bearer-token API for agents to optimize prompts, create and manage MiniMax H3 generation jobs, retrieve videos, and publish to configured platform accounts.",
    },
    servers: [{ url: origin }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "MediaHub",
        },
      },
      schemas: {
        ...previsOpenApiSchemas,
        ...previsRenderOpenApiSchemas,
        GenerationQueue: {
          type: ["object", "null"],
          description:
            "Current queue state for an active video generation or edit. Null for scheduled, terminal, and assembly jobs.",
          required: [
            "phase",
            "aheadSegments",
            "blockingPhase",
            "segmentIndex",
            "segmentCount",
          ],
          properties: {
            phase: {
              type: "string",
              enum: [
                "scheduler",
                "provider_queue",
                "provider_starting",
                "gpu_admission",
                "processing",
                "gpu_cleanup",
                "provider_status_unavailable",
              ],
              description:
                "Waiting for Media Hub scheduling, waiting in the Provider queue, preparing to start, waiting for a GPU lease, processing, releasing GPU resources, or live Provider status unavailable.",
            },
            aheadSegments: {
              type: ["integer", "null"],
              minimum: 0,
              description:
                "Number of earlier segments in this Provider's queue, including the segment occupying the worker. Null when unavailable. Zero does not imply a GPU lease was granted.",
            },
            blockingPhase: {
              enum: [
                "provider_starting",
                "gpu_admission",
                "processing",
                "gpu_cleanup",
                null,
              ],
              description:
                "Phase of the segment occupying the worker while this job is queued. Null if no worker phase is available.",
            },
            segmentIndex: {
              type: ["integer", "null"],
              minimum: 1,
              description: "One-based current segment, or null if unknown.",
            },
            segmentCount: {
              type: ["integer", "null"],
              minimum: 1,
              description: "Total planned segments, or null if unknown.",
            },
          },
        },
        GenerationJob: {
          type: "object",
          required: ["id", "status", "queue"],
          properties: {
            id: { type: "string" },
            status: { type: "string" },
            queue: { $ref: "#/components/schemas/GenerationQueue" },
          },
        },
        GenerationDialogue: {
          type: "object",
          required: ["segment", "speaker_id", "language", "text"],
          properties: {
            segment: { type: "integer", minimum: 1, maximum: 4 },
            speaker_id: {
              type: "string",
              enum: ["S1", "S2", "S3", "S4"],
              description:
                "Stable caller-side identity. Media Hub renumbers speakers by first actual utterance.",
            },
            language: { type: "string", enum: ["zh", "en"] },
            text: { type: "string", minLength: 1, maxLength: 300 },
            voice: {
              type: "string",
              maxLength: 500,
              description:
                "Optional age, timbre, pace, accent, and emotion direction placed outside the H3 dialogue tag.",
            },
            delivery: {
              type: "string",
              enum: ["on_screen", "off_screen_voiceover"],
              default: "on_screen",
            },
          },
        },
        CreateGeneration: {
          type: "object",
          required: ["prompt"],
          allOf: [
            {
              if: {
                required: ["generation_mode"],
                properties: { generation_mode: { const: "reference" } },
              },
              then: {
                required: ["duration_seconds"],
                oneOf: [
                  {
                    required: ["reference_video"],
                    not: { required: ["reference_artifact_id"] },
                  },
                  {
                    required: ["reference_artifact_id"],
                    not: { required: ["reference_video"] },
                  },
                ],
                properties: {
                  duration_seconds: { maximum: 15 },
                  first_frame: { type: "null" },
                },
              },
              else: {
                not: {
                  anyOf: [
                    { required: ["reference_video"] },
                    { required: ["reference_artifact_id"] },
                  ],
                },
              },
            },
          ],
          properties: {
            prompt: {
              type: "string",
              maxLength: MEDIA_H3_PROMPT_MAX_LENGTH,
            },
            generation_mode: {
              type: "string",
              enum: ["base", "reference"],
              default: "base",
              description:
                "Use base with first_frame for white-model composition and placement. For a photorealistic output, reuse an original photo that fits the opening or first make and review a photorealistic still using the white-model layout. Omit reference_video and reference_artifact_id for still guidance. Use reference only when the user explicitly requests motion from a clip and permits video input. Reference mode uses either reference_video or reference_artifact_id and the six-field H3 reference prompt, with an independent output duration of 5–15 seconds.",
            },
            reference_video: {
              type: "object",
              required: ["storage_key", "name", "content_type"],
              description: `One uploaded H.264 MP4, max 50 MB, 24 FPS, matching output aspect. The clip must contain ${MEDIA_H3_REFERENCE_VIDEO_MIN_FRAMES}–${MEDIA_H3_REFERENCE_VIDEO_MAX_FRAMES} frames on the 17n+5 grid (up to about 5 seconds). Video supplies blocking, camera and occlusion; proxy audio is ignored. Source ownership and checksum are verified. Reference conditioning does not guarantee exact geometric reproduction.`,
              properties: {
                storage_key: { type: "string" },
                name: { type: "string", minLength: 1, maxLength: 255 },
                content_type: { type: "string", const: "video/mp4" },
              },
            },
            reference_artifact_id: {
              type: "string",
              format: "uuid",
              description: `Owned successful previs h3_reference MP4 artifact with at most ${MEDIA_H3_REFERENCE_VIDEO_MAX_FRAMES} frames. Set generation_mode=reference. Mutually exclusive with reference_video. Actual media is probed and its checksum pinned with artifact/revision provenance.`,
            },
            language: {
              type: "string",
              enum: ["zh", "en"],
              default: "en",
              description:
                "Language for requested dialogue, visible text, and AI-generated platform descriptions. Optimized production prompts are always returned in English.",
            },
            title: { type: "string", maxLength: 200 },
            duration_seconds: {
              type: "integer",
              minimum: 5,
              maximum: 60,
              default: MEDIA_H3_DEFAULT_DURATION_SECONDS,
            },
            quality_preset: {
              type: "string",
              enum: ["fast", "balanced", "quality"],
              default: MEDIA_H3_DEFAULT_QUALITY_PRESET,
            },
            generation_profile: {
              type: "string",
              maxLength: 200,
              description:
                "Optional H3 generation workflow for this job. Omit to use the administrator default.",
            },
            seed: {
              type: "integer",
              minimum: 0,
              maximum: 2147483643,
            },
            scheduled_at: { type: ["string", "null"], format: "date-time" },
            width: {
              type: "integer",
              default: MEDIA_H3_DEFAULT_WIDTH,
              minimum: 64,
              maximum: 1344,
              multipleOf: 32,
            },
            height: {
              type: "integer",
              default: MEDIA_H3_DEFAULT_HEIGHT,
              minimum: 64,
              maximum: 1344,
              multipleOf: 32,
            },
            first_frame: {
              type: ["object", "null"],
              description:
                "The opening picture for a base-mode shot. For photorealistic footage, supply the selected original photo or a finished photorealistic still. H3 can carry the opening image's textures and lighting through the shot.",
              properties: {
                storage_key: { type: "string" },
                name: { type: "string" },
                content_type: {
                  type: "string",
                  enum: ["image/jpeg", "image/png", "image/webp"],
                },
              },
            },
            reference_images: {
              type: "array",
              maxItems: 4,
              description:
                "Subject or style images within the selected profile's maxReferenceImages limit. In reference mode, use the exact tags <Picture 1>, <Picture 2>, and so on in submitted array order.",
              items: {
                type: "object",
                required: ["storage_key", "name", "content_type", "role"],
                properties: {
                  storage_key: { type: "string" },
                  name: { type: "string" },
                  content_type: {
                    type: "string",
                    enum: ["image/jpeg", "image/png", "image/webp"],
                  },
                  role: { type: "string", enum: ["style", "subject"] },
                },
              },
            },
            reference_audio: {
              type: "array",
              maxItems: 4,
              description:
                "Optional standalone voice references. Requests are rejected with 412 when the selected generation profile does not advertise <Audio N> support; current bundled H3 profiles report zero support.",
              items: {
                type: "object",
                required: ["storage_key", "name", "content_type"],
                properties: {
                  storage_key: { type: "string" },
                  name: { type: "string", maxLength: 255 },
                  content_type: {
                    type: "string",
                    enum: [
                      "audio/aac",
                      "audio/mp4",
                      "audio/mpeg",
                      "audio/wav",
                      "audio/x-wav",
                    ],
                  },
                },
              },
            },
            dialogues: {
              type: "array",
              maxItems: 12,
              description:
                "Authoritative dialogue compiled server-side into normalized H3 speaker IDs and language tags. Do not also put <d> tags in prompt.",
              items: { $ref: "#/components/schemas/GenerationDialogue" },
            },
          },
        },
        CreateVideoEdit: {
          type: "object",
          required: ["segments"],
          properties: {
            title: { type: "string", maxLength: 200 },
            language: {
              type: "string",
              enum: ["zh", "en"],
              default: "en",
              description:
                "Language for requested dialogue and visible text. Optimized edit prompts are always returned in English.",
            },
            scheduled_at: { type: ["string", "null"], format: "date-time" },
            segments: {
              type: "array",
              minItems: 1,
              maxItems: 4,
              description:
                "Non-overlapping source-video ranges. Each segment must last 2–15 seconds.",
              items: {
                type: "object",
                required: ["id", "start_seconds", "end_seconds", "prompt"],
                properties: {
                  id: { type: "string", maxLength: 100 },
                  start_seconds: { type: "number", minimum: 0, maximum: 60 },
                  end_seconds: { type: "number", minimum: 0, maximum: 60 },
                  prompt: { type: "string", maxLength: 5000 },
                  reference_images: {
                    type: "array",
                    maxItems: 4,
                    items: {
                      type: "object",
                      required: ["storage_key", "name", "content_type", "role"],
                      properties: {
                        storage_key: { type: "string" },
                        name: { type: "string", maxLength: 255 },
                        content_type: {
                          type: "string",
                          enum: ["image/jpeg", "image/png", "image/webp"],
                        },
                        role: { type: "string", enum: ["style", "subject"] },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        VideoScriptDialogue: {
          type: "object",
          required: ["at_seconds", "speaker_id", "language", "text"],
          properties: {
            id: { type: "string" },
            at_seconds: { type: "number", minimum: 0, maximum: 15 },
            speaker_id: { type: "string", enum: ["S1", "S2", "S3", "S4"] },
            language: { type: "string", enum: ["zh", "en"] },
            text: { type: "string", minLength: 1, maxLength: 300 },
            voice: { type: "string", maxLength: 500 },
            delivery: {
              type: "string",
              enum: ["on_screen", "off_screen_voiceover"],
            },
          },
        },
        VideoScriptContinuityBible: {
          type: "object",
          properties: {
            characters: { type: "string", maxLength: 3000 },
            wardrobe_and_props: { type: "string", maxLength: 3000 },
            locations_and_lighting: { type: "string", maxLength: 3000 },
            visual_rules: { type: "string", maxLength: 3000 },
          },
        },
        VideoScriptShot: {
          type: "object",
          required: ["title", "duration_seconds", "visual_description"],
          properties: {
            id: { type: "string" },
            title: { type: "string", maxLength: 120 },
            duration_seconds: {
              type: "integer",
              minimum: 5,
              maximum: MEDIA_H3_SCRIPT_SHOT_SECONDS,
              default: MEDIA_H3_SCRIPT_SHOT_SECONDS,
              description:
                "Prefer a full 15-second H3 unit. Only the final remainder shot should normally be shorter.",
            },
            visual_description: { type: "string", maxLength: 5000 },
            camera_direction: { type: "string", maxLength: 1000 },
            continuity: { type: "string", maxLength: 1000 },
            soundscape: { type: "string", maxLength: 1000 },
            music: { type: "string", maxLength: 1000, default: "N/A" },
            dialogues: {
              type: "array",
              maxItems: 6,
              items: { $ref: "#/components/schemas/VideoScriptDialogue" },
            },
            first_frame_asset_id: {
              type: ["string", "null"],
              description:
                "Select the opening image asset. For photorealistic white-model guidance, choose a suitable original photo or a finished photorealistic still. Selecting this image clears any pinned video reference. Set null to clear the first-frame reference.",
            },
            reference_artifact_id: {
              type: ["string", "null"],
              format: "uuid",
              description: `Use this field only for explicitly requested motion guidance when video input is allowed. Select a successful H3-reference MP4 with at most ${MEDIA_H3_REFERENCE_VIDEO_MAX_FRAMES} frames. Selecting this video clears the first-frame image. Set null to clear. Generate these shots in independent mode and assemble later.`,
            },
          },
        },
        VideoScriptCaption: {
          type: "object",
          required: ["start_seconds", "end_seconds", "text"],
          properties: {
            id: { type: "string" },
            start_seconds: { type: "number", minimum: 0, maximum: 15 },
            end_seconds: { type: "number", minimum: 0, maximum: 15 },
            text: { type: "string", maxLength: 300 },
          },
        },
        VideoScriptShotEditPlan: {
          type: "object",
          required: ["version"],
          properties: {
            version: { type: "integer", minimum: 1 },
            trim_start_seconds: { type: "number", minimum: 0, maximum: 15 },
            trim_end_seconds: { type: "number", minimum: 0, maximum: 15 },
            captions: {
              type: "array",
              maxItems: 12,
              items: { $ref: "#/components/schemas/VideoScriptCaption" },
            },
          },
        },
        CreateVideoScript: {
          type: "object",
          required: ["title", "brief"],
          properties: {
            title: { type: "string", maxLength: 200 },
            brief: { type: "string", maxLength: 10000 },
            copy: { type: "string", maxLength: 20000, default: "" },
            copy_status: {
              type: "string",
              enum: ["draft", "approved"],
              default: "draft",
            },
            language: { type: "string", enum: ["zh", "en"], default: "zh" },
            width: {
              type: "integer",
              minimum: 64,
              maximum: 1344,
              multipleOf: 32,
              default: MEDIA_H3_DEFAULT_WIDTH,
            },
            height: {
              type: "integer",
              minimum: 64,
              maximum: 1344,
              multipleOf: 32,
              default: MEDIA_H3_DEFAULT_HEIGHT,
            },
            default_profile: { type: "string", maxLength: 200 },
            continuity_bible: {
              $ref: "#/components/schemas/VideoScriptContinuityBible",
            },
            shots: {
              type: "array",
              maxItems: 12,
              items: { $ref: "#/components/schemas/VideoScriptShot" },
            },
          },
        },
        PatchVideoScript: {
          type: "object",
          required: ["version"],
          properties: {
            version: { type: "integer", minimum: 1 },
            title: { type: "string", maxLength: 200 },
            brief: { type: "string", maxLength: 10000 },
            copy: { type: "string", maxLength: 20000 },
            copy_status: {
              type: "string",
              enum: ["draft", "approved"],
              description:
                "Changing copy always returns the stored script to draft; approve it in a subsequent version-locked update.",
            },
            language: { type: "string", enum: ["zh", "en"] },
            width: {
              type: "integer",
              minimum: 64,
              maximum: 1344,
              multipleOf: 32,
            },
            height: {
              type: "integer",
              minimum: 64,
              maximum: 1344,
              multipleOf: 32,
            },
            default_profile: { type: ["string", "null"], maxLength: 200 },
            continuity_bible: {
              $ref: "#/components/schemas/VideoScriptContinuityBible",
            },
            shots: {
              type: "array",
              maxItems: 12,
              items: { $ref: "#/components/schemas/VideoScriptShot" },
            },
          },
        },
        DraftVideoScript: {
          type: "object",
          required: ["brief"],
          properties: {
            title: { type: "string", maxLength: 200 },
            brief: { type: "string", maxLength: 10000 },
            language: { type: "string", enum: ["zh", "en"], default: "zh" },
            target_duration_seconds: {
              type: "integer",
              enum: [...MEDIA_H3_SCRIPT_TARGET_DURATIONS],
              default: 30,
              description:
                "Choose 15, 30, 45, or 60 seconds. When shot_count is omitted, the draft uses one 15-second H3 shot per segment.",
            },
            shot_count: { type: "integer", minimum: 1, maximum: 12 },
          },
        },
        GenerateVideoScript: {
          type: "object",
          properties: {
            shot_ids: {
              type: "array",
              maxItems: 12,
              description: "Empty or omitted means every shot.",
              items: { type: "string" },
            },
            quality_preset: {
              type: "string",
              enum: ["fast", "balanced", "quality"],
              default: "balanced",
            },
            generation_profile: {
              type: "string",
              maxLength: 200,
              description:
                "Override the base workflow in a mixed batch. Reference shots use the configured reference workflow. For a reference-only request this may override that reference workflow; when omitted, the configured reference workflow is used independently of the script's base default.",
            },
            continuity_mode: {
              type: "string",
              enum: ["native_av", "independent"],
              description:
                "When omitted, reference-containing batches use independent shots; otherwise use native AV if the selected workflow supports it. Explicit native AV cannot be combined with white-model reference shots. Native AV requires supportsNativeAVContinuation and conditions each later shot on the preceding accepted shot's synchronized tail. Shots are at most 15 seconds.",
            },
          },
        },
        AnalyzeVideoScript: {
          type: "object",
          required: ["shots"],
          properties: {
            shots: {
              type: "array",
              maxItems: 12,
              items: { $ref: "#/components/schemas/VideoScriptShot" },
            },
          },
        },
        CarryVideoScriptFinalFrame: {
          type: "object",
          required: ["version"],
          properties: {
            version: { type: "integer", minimum: 1 },
          },
        },
        CreateVideoScriptFrameCandidates: {
          type: "object",
          properties: {
            output_count: {
              type: "integer",
              minimum: 1,
              maximum: 4,
              default: 4,
            },
          },
        },
        SelectVideoScriptFrameCandidate: {
          type: "object",
          required: ["asset_id", "version"],
          properties: {
            asset_id: {
              type: ["string", "null"],
              description:
                "A candidate asset created for this exact script shot, or null to clear the selection.",
            },
            version: { type: "integer", minimum: 1 },
          },
        },
      },
    },
    security: bearerSecurity,
    paths: {
      ...previsOpenApiPaths(errorResponses),
      ...previsRenderOpenApiPaths(errorResponses),
      "/api/v1/prompts/optimize": {
        post: {
          operationId: "optimizeVideoPrompt",
          summary: "Optimize a MiniMax H3 video prompt",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  allOf: [
                    { $ref: "#/components/schemas/CreateGeneration" },
                    {
                      type: "object",
                      properties: {
                        has_reference_image: { type: "boolean" },
                        dialogues: {
                          type: "array",
                          maxItems: 12,
                          description:
                            "Authoritative verbatim dialogue lines for H3 original audio.",
                          items: {
                            $ref: "#/components/schemas/GenerationDialogue",
                          },
                        },
                      },
                    },
                  ],
                },
              },
            },
          },
          responses: {
            "200": { description: "Optimized prompt" },
            ...errorResponses,
          },
        },
      },
      "/api/v1/generations": {
        get: {
          operationId: "listGenerationJobs",
          summary: "List generation jobs",
          parameters: [
            {
              name: "page",
              in: "query",
              schema: { type: "integer", default: 1 },
            },
            {
              name: "page_size",
              in: "query",
              schema: { type: "integer", default: 20, maximum: 100 },
            },
            { name: "status", in: "query", schema: { type: "string" } },
            {
              name: "whole_videos_only",
              in: "query",
              description:
                "Exclude individual script-shot jobs; return standalone videos and assembled script videos.",
              schema: { type: "boolean", default: false },
            },
          ],
          responses: {
            "200": {
              description: "Generation job page",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["rows", "total", "page", "pageSize"],
                    properties: {
                      rows: {
                        type: "array",
                        items: {
                          anyOf: [
                            { $ref: "#/components/schemas/GenerationJob" },
                            {
                              type: "object",
                              required: ["id", "isPrivate"],
                              properties: {
                                id: { type: "string" },
                                isPrivate: { const: true },
                              },
                            },
                          ],
                        },
                      },
                      total: { type: "integer" },
                      page: { type: "integer" },
                      pageSize: { type: "integer" },
                    },
                  },
                },
              },
            },
            ...errorResponses,
          },
        },
        post: {
          operationId: "createGenerationJob",
          summary: "Create or schedule a video generation job",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CreateGeneration" },
              },
            },
          },
          responses: {
            "201": { description: "Generation job created" },
            ...errorResponses,
          },
        },
      },
      "/api/v1/generation-profiles": {
        get: {
          operationId: "listGenerationProfiles",
          summary:
            "List available H3 generation workflows and the admin default",
          description:
            "Includes base profiles and profiles advertising supportsReferenceVideo. default_reference_generation_profile selects the configured Ref2VA workflow. reference_video_constraints reports the uploaded clip and output duration limits separately. Older providers without the capability are rejected with 412.",
          responses: {
            "200": { description: "H3 generation profiles" },
            ...errorResponses,
          },
        },
      },
      "/api/v1/image-assets": {
        get: {
          operationId: "listImageAssets",
          summary:
            "List the current user's private image assets for script frames",
          parameters: [
            {
              name: "limit",
              in: "query",
              schema: {
                type: "integer",
                minimum: 1,
                maximum: 100,
                default: 100,
              },
            },
          ],
          responses: {
            "200": { description: "Private image assets" },
            ...errorResponses,
          },
        },
      },
      "/api/v1/scripts": {
        get: {
          operationId: "listVideoScripts",
          summary: "List the current user's video scripts",
          parameters: [
            {
              name: "page",
              in: "query",
              schema: { type: "integer", default: 1 },
            },
            {
              name: "page_size",
              in: "query",
              schema: { type: "integer", default: 30, maximum: 100 },
            },
          ],
          responses: {
            "200": { description: "Video script page" },
            ...errorResponses,
          },
        },
        post: {
          operationId: "createVideoScript",
          summary: "Create a structured video script",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CreateVideoScript" },
              },
            },
          },
          responses: {
            "201": { description: "Video script created" },
            ...errorResponses,
          },
        },
      },
      "/api/v1/scripts/draft": {
        post: {
          operationId: "draftVideoScript",
          summary: "Generate a structured script draft from a creative brief",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/DraftVideoScript" },
              },
            },
          },
          responses: {
            "200": { description: "Generated script draft" },
            ...errorResponses,
          },
        },
      },
      "/api/v1/scripts/analyze": {
        post: {
          operationId: "analyzeVideoScript",
          summary: "Check shot duration and original-dialogue speaking pace",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AnalyzeVideoScript" },
              },
            },
          },
          responses: {
            "200": { description: "Shot-level production warnings" },
            ...errorResponses,
          },
        },
      },
      "/api/v1/scripts/{scriptId}": {
        parameters: [
          {
            name: "scriptId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        get: {
          operationId: "getVideoScript",
          summary: "Get a script, its shots, and related generation jobs",
          responses: {
            "200": { description: "Video script" },
            ...errorResponses,
          },
        },
        patch: {
          operationId: "updateVideoScript",
          summary: "Update a script using optimistic version locking",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/PatchVideoScript" },
              },
            },
          },
          responses: {
            "200": { description: "Video script updated" },
            ...errorResponses,
          },
        },
        delete: {
          operationId: "deleteVideoScript",
          summary: "Soft-delete a video script",
          responses: {
            "200": { description: "Video script deleted" },
            ...errorResponses,
          },
        },
      },
      "/api/v1/scripts/{scriptId}/generate": {
        post: {
          operationId: "generateVideoScriptShots",
          summary:
            "Queue script shots as H3 jobs; when every latest shot succeeds, Media Hub automatically assembles the final MP4",
          parameters: [
            {
              name: "scriptId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/GenerateVideoScript" },
              },
            },
          },
          responses: {
            "201": { description: "Shot generation jobs queued" },
            ...errorResponses,
          },
        },
      },
      "/api/v1/scripts/{scriptId}/assemble": {
        post: {
          operationId: "assembleVideoScript",
          summary:
            "Assemble selected shot takes with trims and optional burned captions into a publishable MP4",
          parameters: [
            {
              name: "scriptId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    burn_captions: { type: "boolean", default: false },
                    source_job_ids: {
                      type: "array",
                      minItems: 2,
                      maxItems: 20,
                      description:
                        "Existing successful shot jobs in script order",
                      items: { type: "string", format: "uuid" },
                    },
                    transition: {
                      type: "string",
                      enum: ["cut", "fade_white", "fade_black"],
                      default: "cut",
                    },
                    rebuild: {
                      type: "boolean",
                      default: false,
                      description:
                        "Replace a successful draft video in place before publishing begins",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "201": {
              description:
                "Assembly job and publishable draft. The same source shot set is idempotent.",
            },
            ...errorResponses,
          },
        },
      },
      "/api/v1/scripts/{scriptId}/animatic": {
        post: {
          operationId: "createVideoScriptAnimatic",
          summary: "Render a low-cost preview from each selected first frame",
          parameters: [
            {
              name: "scriptId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "201": { description: "Animatic URLs and script version" },
            ...errorResponses,
          },
        },
      },
      "/api/v1/scripts/{scriptId}/animatic/{version}/video": {
        get: {
          operationId: "downloadVideoScriptAnimatic",
          summary: "Stream the current animatic MP4 with Bearer authorization",
          parameters: [
            {
              name: "scriptId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
            {
              name: "version",
              in: "path",
              required: true,
              schema: { type: "integer" },
            },
          ],
          responses: {
            "200": { description: "Animatic MP4" },
            "206": { description: "Partial animatic MP4" },
            ...errorResponses,
          },
        },
      },
      "/api/v1/scripts/{scriptId}/shots/{shotId}/take": {
        patch: {
          operationId: "selectVideoScriptTake",
          summary: "Select a successful shot take for final assembly",
          parameters: [
            {
              name: "scriptId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
            {
              name: "shotId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["job_id", "version"],
                  properties: {
                    job_id: { type: "string" },
                    version: { type: "integer", minimum: 1 },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Updated script" },
            ...errorResponses,
          },
        },
      },
      "/api/v1/scripts/{scriptId}/shots/{shotId}/edit-plan": {
        patch: {
          operationId: "updateVideoScriptShotEditPlan",
          summary: "Set shot trim and corrected captions with version locking",
          parameters: [
            {
              name: "scriptId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
            {
              name: "shotId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/VideoScriptShotEditPlan",
                },
              },
            },
          },
          responses: {
            "200": { description: "Updated script" },
            ...errorResponses,
          },
        },
      },
      "/api/v1/scripts/{scriptId}/shots/{shotId}/captions/generate": {
        post: {
          operationId: "generateVideoScriptShotCaptions",
          summary:
            "Create editable timed captions from authoritative shot dialogue",
          parameters: [
            {
              name: "scriptId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
            {
              name: "shotId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["version"],
                  properties: { version: { type: "integer", minimum: 1 } },
                },
              },
            },
          },
          responses: {
            "200": { description: "Updated script with draft captions" },
            ...errorResponses,
          },
        },
      },
      "/api/v1/scripts/{scriptId}/shots/{shotId}/carry-final-frame": {
        post: {
          operationId: "carryVideoScriptFinalFrame",
          summary:
            "Extract the latest successful shot's final frame and set it as the next shot's first frame",
          parameters: [
            {
              name: "scriptId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
            {
              name: "shotId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/CarryVideoScriptFinalFrame",
                },
              },
            },
          },
          responses: {
            "201": { description: "Final frame stored and next shot updated" },
            ...errorResponses,
          },
        },
      },
      "/api/v1/scripts/{scriptId}/shots/{shotId}/frames": {
        parameters: [
          {
            name: "scriptId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
          {
            name: "shotId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        get: {
          operationId: "listVideoScriptFrameCandidates",
          summary:
            "List private first-frame jobs and candidates for one script shot",
          responses: {
            "200": { description: "First-frame jobs and candidate assets" },
            ...errorResponses,
          },
        },
        post: {
          operationId: "createVideoScriptFrameCandidates",
          summary:
            "Queue 1–4 first-frame candidates after the script copy is approved",
          description: "Uses the same configured image model as Image Studio.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/CreateVideoScriptFrameCandidates",
                },
              },
            },
          },
          responses: {
            "201": { description: "First-frame image job queued" },
            ...errorResponses,
          },
        },
      },
      "/api/v1/scripts/{scriptId}/shots/{shotId}/frames/select": {
        patch: {
          operationId: "selectVideoScriptFrameCandidate",
          summary:
            "Select or clear a first-frame candidate using optimistic version locking",
          parameters: [
            {
              name: "scriptId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
            {
              name: "shotId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/SelectVideoScriptFrameCandidate",
                },
              },
            },
          },
          responses: {
            "200": { description: "Updated script" },
            ...errorResponses,
          },
        },
      },
      "/api/v1/uploads/presign": {
        post: {
          operationId: "createReferenceImageUpload",
          summary: "Upload or presign a reference image or previs MP4",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["filename", "content_type", "size_bytes"],
                  properties: {
                    filename: { type: "string" },
                    content_type: {
                      type: "string",
                      enum: [
                        "image/jpeg",
                        "image/png",
                        "image/webp",
                        "video/mp4",
                      ],
                    },
                    size_bytes: {
                      type: "integer",
                      minimum: 1,
                      maximum: 50000000,
                      description: "Images: max 5 MB. Previs MP4: max 50 MB.",
                    },
                    content_base64: {
                      type: "string",
                      description:
                        "Optional canonical base64 file content. When present, Media Hub stores the file server-side and upload_url is null; useful when the signed storage URL is not reachable from the agent.",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "201": { description: "Presigned upload URL" },
            ...errorResponses,
          },
        },
      },
      "/api/v1/generations/{jobId}": {
        parameters: [
          {
            name: "jobId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        get: {
          operationId: "getGenerationJob",
          summary: "Get a generation job",
          description:
            "A succeeded job has a processed video file. Review the actual video frames before accepting or delivering the result.",
          responses: {
            "200": {
              description: "Generation job",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/GenerationJob" },
                },
              },
            },
            ...errorResponses,
          },
        },
        patch: {
          operationId: "updateGenerationJob",
          summary: "Update a queued or scheduled job",
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    prompt: { type: "string" },
                    language: { type: "string", enum: ["zh", "en"] },
                    title: { type: ["string", "null"] },
                    duration_seconds: {
                      type: "integer",
                      minimum: 5,
                      maximum: 60,
                    },
                    quality_preset: {
                      type: "string",
                      enum: ["fast", "balanced", "quality"],
                    },
                    scheduled_at: {
                      type: ["string", "null"],
                      format: "date-time",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Generation job updated" },
            ...errorResponses,
          },
        },
        delete: {
          operationId: "cancelGenerationJob",
          summary: "Cancel an active job or delete a terminal job",
          responses: {
            "200": { description: "Generation job canceled" },
            ...errorResponses,
          },
        },
      },
      "/api/v1/generations/{jobId}/video": {
        get: {
          operationId: "downloadGenerationVideo",
          summary: "Stream a completed MP4 video; supports Range requests",
          parameters: [
            {
              name: "jobId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
            {
              name: "download",
              in: "query",
              description: "Set to 1 to return the MP4 as an attachment.",
              schema: { type: "string", enum: ["1"] },
            },
          ],
          responses: {
            "200": { description: "MP4 video" },
            "206": { description: "Partial MP4 video" },
            ...errorResponses,
          },
        },
      },
      "/api/v1/generations/{jobId}/edits": {
        post: {
          operationId: "createVideoEditJob",
          summary:
            "Modify selected time ranges of a completed video with Ref2VA",
          parameters: [
            {
              name: "jobId",
              in: "path",
              required: true,
              description: "Completed source generation job ID",
              schema: { type: "string" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CreateVideoEdit" },
              },
            },
          },
          responses: {
            "201": {
              description:
                "Video edit job created. Script-linked source jobs retain their script and shot association.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["id", "status", "source_generation_job_id"],
                    properties: {
                      id: { type: "string" },
                      status: {
                        type: "string",
                        enum: ["queued", "scheduled"],
                      },
                      source_generation_job_id: { type: "string" },
                      script_id: { type: ["string", "null"] },
                      script_shot_id: { type: ["string", "null"] },
                    },
                  },
                },
              },
            },
            ...errorResponses,
          },
        },
      },
      "/api/v1/generations/{jobId}/retry": {
        post: {
          operationId: "retryGenerationJob",
          summary: "Retry a failed generation or Ref2VA edit job",
          parameters: [
            {
              name: "jobId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "202": { description: "Job queued for retry" },
            ...errorResponses,
          },
        },
      },
      "/api/v1/platform-accounts": {
        get: {
          operationId: "listPlatformAccounts",
          summary: "List configured publishing accounts",
          responses: {
            "200": { description: "Platform accounts" },
            ...errorResponses,
          },
        },
      },
      "/api/v1/generations/{jobId}/publish": {
        post: {
          operationId: "publishGenerationVideo",
          summary: "Publish a completed video to selected platform accounts",
          parameters: [
            {
              name: "jobId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["targets"],
                  properties: {
                    targets: {
                      type: "array",
                      items: {
                        type: "object",
                        required: ["account_id"],
                        properties: {
                          account_id: { type: "string" },
                          title: { type: "string" },
                          description: { type: "string" },
                          hashtags: { type: "string" },
                          scheduled_at: {
                            type: ["string", "null"],
                            format: "date-time",
                          },
                          youtube: { type: "object" },
                          instagram: { type: "object" },
                          douyin: {
                            type: "object",
                            properties: {
                              private_status: {
                                type: "integer",
                                enum: [0, 1, 2],
                                default: 0,
                              },
                              allow_download: {
                                type: "boolean",
                                default: true,
                              },
                              cover_time_seconds: {
                                type: ["number", "null"],
                                minimum: 0,
                                maximum: 3600,
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          responses: {
            "202": { description: "Publishing queued" },
            ...errorResponses,
          },
        },
      },
      "/api/v1/generations/{jobId}/xiaohongshu-package": {
        post: {
          operationId: "prepareXiaohongshuPublishPackage",
          summary:
            "Prepare a Xiaohongshu caption and temporary video URL for user-confirmed publishing",
          parameters: [
            {
              name: "jobId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description:
                "Xiaohongshu publish package; final posting requires confirmation in the Xiaohongshu app",
            },
            ...errorResponses,
          },
        },
      },
      "/api/v1/generations/{jobId}/notify": {
        post: {
          operationId: "resendGenerationNotification",
          summary:
            "Send the generation result to the owner's Feishu Webhook again",
          parameters: [
            {
              name: "jobId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": { description: "Notification sent" },
            ...errorResponses,
          },
        },
      },
    },
  };
}

export const Route = createFileRoute("/api/openapi")({
  server: {
    handlers: {
      GET: ({ request }) =>
        Response.json(openApiDocument(request), {
          headers: { "Cache-Control": "public, max-age=300" },
        }),
    },
  },
});
