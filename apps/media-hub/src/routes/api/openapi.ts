import { createFileRoute } from "@tanstack/react-router";

import {
  MEDIA_H3_DEFAULT_DURATION_SECONDS,
  MEDIA_H3_DEFAULT_HEIGHT,
  MEDIA_H3_DEFAULT_QUALITY_PRESET,
  MEDIA_H3_DEFAULT_WIDTH,
  MEDIA_H3_PROMPT_MAX_LENGTH,
} from "@acme/validators";

function openApiDocument(request: Request) {
  const origin = new URL(request.url).origin;
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
      version: "1.4.0",
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
        CreateGeneration: {
          type: "object",
          required: ["prompt"],
          properties: {
            prompt: {
              type: "string",
              maxLength: MEDIA_H3_PROMPT_MAX_LENGTH,
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
              maximum: 15,
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
            first_frame_asset_id: { type: "string" },
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
              minimum: 5,
              maximum: 180,
              default: 30,
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
            generation_profile: { type: "string", maxLength: 200 },
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
                            type: "object",
                            required: [
                              "segment",
                              "speaker_id",
                              "language",
                              "text",
                            ],
                            properties: {
                              segment: {
                                type: "integer",
                                minimum: 1,
                                maximum: 4,
                              },
                              speaker_id: {
                                type: "string",
                                enum: ["S1", "S2", "S3", "S4"],
                              },
                              language: {
                                type: "string",
                                enum: ["zh", "en"],
                              },
                              text: {
                                type: "string",
                                minLength: 1,
                                maxLength: 300,
                              },
                            },
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
          ],
          responses: {
            "200": { description: "Generation job page" },
            ...errorResponses,
          },
        },
        post: {
          operationId: "createGenerationJob",
          summary: "Create or schedule a text-to-video generation job",
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
          summary: "Queue selected or all script shots as independent H3 jobs",
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
            "List private HiDream first-frame jobs and candidates for one script shot",
          responses: {
            "200": { description: "First-frame jobs and candidate assets" },
            ...errorResponses,
          },
        },
        post: {
          operationId: "createVideoScriptFrameCandidates",
          summary:
            "Queue 1–4 HiDream first-frame candidates after the script copy is approved",
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
            "201": { description: "HiDream image job queued" },
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
          summary: "Create a presigned PUT URL for a reference image",
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
                      enum: ["image/jpeg", "image/png", "image/webp"],
                    },
                    size_bytes: {
                      type: "integer",
                      minimum: 1,
                      maximum: 5000000,
                    },
                    content_base64: {
                      type: "string",
                      description:
                        "Optional base64 image content. When present, Media Hub stores the image server-side and upload_url is null.",
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
          responses: {
            "200": { description: "Generation job" },
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
