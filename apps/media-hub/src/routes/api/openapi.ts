import { createFileRoute } from "@tanstack/react-router";

function openApiDocument(request: Request) {
  const origin = new URL(request.url).origin;
  const bearerSecurity = [{ bearerAuth: [] }];
  const errorResponses = {
    "400": { description: "Invalid request" },
    "401": { description: "Invalid or missing Bearer token" },
    "403": { description: "Insufficient permission" },
    "404": { description: "Resource not found" },
    "409": { description: "Operation conflicts with current state" },
  };
  return {
    openapi: "3.1.0",
    info: {
      title: "Pumpkii Media Hub Agent API",
      version: "1.1.0",
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
            prompt: { type: "string", maxLength: 5000 },
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
              default: 30,
            },
            scheduled_at: { type: ["string", "null"], format: "date-time" },
            width: {
              type: "integer",
              default: 960,
              minimum: 64,
              maximum: 1344,
              multipleOf: 32,
            },
            height: {
              type: "integer",
              default: 544,
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
                      properties: { has_reference_image: { type: "boolean" } },
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
            "201": { description: "Video edit job created" },
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
            "Send the completed video and generation parameters to Feishu again",
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
