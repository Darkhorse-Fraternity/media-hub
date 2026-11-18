import { z } from "zod/v4";

import { createMediaPrevisRenderSchema } from "@acme/validators";

const renderSchema = z.toJSONSchema(
  z
    .object(createMediaPrevisRenderSchema.shape)
    .omit({ id: true, idempotencyKey: true }),
  { io: "input" },
);
const names: Record<string, string> = {
  revisionId: "revision_id",
  outputType: "output_type",
  viewIds: "view_ids",
  timelineFps: "timeline_fps",
  startSeconds: "start_seconds",
  durationSeconds: "duration_seconds",
};
export const previsRenderOpenApiSchemas = {
  PrevisCreateRender: {
    ...renderSchema,
    properties: Object.fromEntries(
      Object.entries(renderSchema.properties ?? {}).map(([key, value]) => [
        names[key] ?? key,
        value,
      ]),
    ),
    required: ["revision_id"],
    description:
      "Pins an owned revision. Images expand in view_ids order then frames order (1-based at timeline_fps); empty view_ids selects the scene camera. Max 64 items, 128 outstanding items per owner, 2073600 pixels/frame and 50 MB/artifact. Video requires even dimensions and <=900 frames. preview has a 896×512 pixel budget. h3_reference requires video, 24 FPS, 5–15 integer nominal seconds and dimensions <=1344; actual frame grid is validated by ffprobe. Non-looping motion must cover sampling; H3's end padding holds the final pose and is recorded in artifact metadata. CPU execution only.",
  },
  PrevisChangeRender: {
    type: "object",
    additionalProperties: false,
    properties: {
      item_ids: {
        type: "array",
        minItems: 1,
        maxItems: 64,
        items: { type: "string", format: "uuid" },
      },
    },
    description:
      "Omit item_ids for all eligible items. Cancellation of a running item becomes terminal after the owned engine stops. Retry only failed, interrupted or canceled items; successful artifacts are retained, attempts are append-only, maximum 10 attempts/item.",
  },
  PrevisImportImages: {
    type: "object",
    additionalProperties: false,
    required: ["artifact_ids"],
    properties: {
      artifact_ids: {
        type: "array",
        minItems: 1,
        maxItems: 64,
        items: { type: "string", format: "uuid" },
      },
    },
    description:
      "Owned successful PNGs in this batch. Repeated imports reuse the same image asset ID, restoring a hidden asset if necessary; never create an AI image job.",
  },
};
export function previsRenderOpenApiPaths(
  errors: Record<string, { description: string }>,
) {
  const param = (name: string) => ({
    name,
    in: "path",
    required: true,
    schema: { type: "string", format: "uuid" },
  });
  const paging = [
    {
      name: "page",
      in: "query",
      schema: { type: "integer", minimum: 1, default: 1 },
    },
    {
      name: "page_size",
      in: "query",
      schema: { type: "integer", minimum: 1, maximum: 100, default: 30 },
    },
  ];
  const security = [{ bearerAuth: [] }];
  const body = (name: string) => ({
    required: true,
    content: {
      "application/json": { schema: { $ref: `#/components/schemas/${name}` } },
    },
  });
  const base = (
    operationId: string,
    summary: string,
    parameters: unknown[],
    response: string,
    status = "200",
  ) => ({
    operationId,
    summary,
    tags: ["previs"],
    security,
    parameters,
    responses: {
      [status]: { description: response },
      ...errors,
      "412": {
        description:
          "Precondition failed, unsupported engine or feature disabled",
      },
      "429": { description: "Item or storage quota exceeded" },
    },
  });
  return {
    "/api/v1/previs/{sceneId}/renders": {
      get: {
        ...base(
          "listPrevisRenders",
          "List a scene's render batches",
          [param("sceneId"), ...paging],
          "{items, total, page, pageSize}; each batch contains status, counts, total and completed.",
        ),
      },
      post: {
        ...base(
          "createPrevisRender",
          "Queue a pinned Crucible render batch",
          [
            param("sceneId"),
            {
              name: "Idempotency-Key",
              in: "header",
              schema: { type: "string", maxLength: 128 },
              description:
                "Owner-scoped render key. Same input reuses the batch; different input returns 409.",
            },
          ],
          "Render batch ID, immutable request snapshot and status/progress; poll render/items.",
          "202",
        ),
        requestBody: body("PrevisCreateRender"),
      },
    },
    "/api/v1/previs-renders/{renderId}": {
      get: base(
        "getPrevisRender",
        "Read batch status and counts",
        [param("renderId")],
        "Batch status: queued|running|succeeded|partial|failed|canceled; item counts and completed/total.",
      ),
    },
    "/api/v1/previs-renders/{renderId}/items": {
      get: base(
        "listPrevisRenderItems",
        "Read ordered items, attempt history and successful artifacts",
        [param("renderId"), ...paging],
        "{items, total, page, pageSize}; each item includes fixed spec, current status, all attempts, error and artifact. Artifact includes revisionId, attemptId, SHA-256, media parameters and optional imageAssetId.",
      ),
    },
    "/api/v1/previs-renders/{renderId}/cancel": {
      post: {
        ...base(
          "cancelPrevisRender",
          "Cancel all or selected unfinished items",
          [param("renderId")],
          "Updated batch status; running items stop asynchronously.",
        ),
        requestBody: { ...body("PrevisChangeRender"), required: false },
      },
    },
    "/api/v1/previs-renders/{renderId}/retry": {
      post: {
        ...base(
          "retryPrevisRender",
          "Retry failed, interrupted or canceled items",
          [param("renderId")],
          "Updated batch status; successful items are never rerun.",
        ),
        requestBody: { ...body("PrevisChangeRender"), required: false },
      },
    },
    "/api/v1/previs-renders/{renderId}/image-assets": {
      post: {
        ...base(
          "importPrevisImages",
          "Idempotently add PNGs to the existing image library",
          [param("renderId")],
          "{assets: [{artifactId, assetId}]}; use asset IDs in the image generation module.",
        ),
        requestBody: body("PrevisImportImages"),
      },
    },
    "/api/v1/previs-artifacts/{artifactId}/download": {
      get: base(
        "downloadPrevisArtifact",
        "Download an owned PNG or MP4",
        [
          param("artifactId"),
          {
            name: "inline",
            in: "query",
            schema: { type: "string", enum: ["1"] },
          },
          { name: "Range", in: "header", schema: { type: "string" } },
        ],
        "Binary image/png or video/mp4. Private caching; supports single byte ranges (206).",
      ),
    },
  };
}
