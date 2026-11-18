import { z } from "zod/v4";

import {
  MEDIA_PREVIS_ENGINE_VERSION,
  mediaPrevisOperationSchema,
  mediaPrevisRecipeSchema,
  mediaPrevisViewSchema,
} from "@acme/validators";

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const uuid = { type: "string", format: "uuid" };
const nullableUuid = { ...uuid, type: ["string", "null"] };
const recipe = z.toJSONSchema(
  mediaPrevisRecipeSchema.omit({
    environment: true,
    effects: true,
    shadow: true,
  }),
  { io: "input" },
);

export const previsOpenApiSchemas = {
  PrevisRecipe: {
    ...recipe,
    description: `Crucible ${MEDIA_PREVIS_ENGINE_VERSION} CPU-authoring subset: box, sphere and cylinder; stable nodes, transforms, materials, camera and simple motion. Coordinates are metres with +Y up; rotations are XYZW quaternions; motion times are seconds. At most 256 KiB after canonicalization. No Blender, external assets, games, simulations or executable code. Resource references, camera geometry and motion are validated by the pinned engine.`,
    properties: {
      ...recipe.properties,
      environment: {
        type: "object",
        description:
          "Crucible lighting/environment settings; validated by the engine.",
      },
      effects: {
        type: "object",
        description: "Crucible effect settings; validated by the engine.",
      },
      shadow: {
        type: "object",
        description: "Crucible shadow settings; validated by the engine.",
      },
    },
  },
  PrevisView: z.toJSONSchema(mediaPrevisViewSchema),
  PrevisOperation: z.toJSONSchema(mediaPrevisOperationSchema),
  PrevisCreateScene: {
    type: "object",
    additionalProperties: false,
    required: ["title"],
    properties: {
      title: { type: "string", minLength: 1, maxLength: 200 },
      description: { type: "string", maxLength: 2000, default: "" },
      group_id: nullableUuid,
      recipe: ref("PrevisRecipe"),
      views: {
        type: "array",
        maxItems: 8,
        items: ref("PrevisView"),
        description: "Unique view IDs. Omitted: empty list.",
      },
    },
    description:
      "Creates a private scene and immutable initial revision atomically. Omitted recipe creates an empty static scene. Response fields use camelCase; Crucible recipe/operation fields retain their native spelling.",
  },
  PrevisPatchScene: {
    type: "object",
    additionalProperties: false,
    required: ["version"],
    properties: {
      version: {
        type: "integer",
        minimum: 1,
        description:
          "Latest scene.version; every scene mutation advances it, including branch creation.",
      },
      title: { type: "string", minLength: 1, maxLength: 200 },
      description: { type: "string", maxLength: 2000 },
      archived: { type: "boolean" },
      group_id: nullableUuid,
      thumbnail_artifact_id: {
        ...nullableUuid,
        description:
          "Owned PNG from this scene selects a manual cover; null restores automatic thumbnails for the current revision.",
      },
      head_revision_id: uuid,
      expected_head_revision_id: uuid,
    },
    description:
      "Supply at least one mutable field. Selecting or rolling back to a revision requires expected_head_revision_id as well as version. The selected revision must belong to this scene. No revision is rewritten.",
  },
  PrevisCreateRevision: {
    type: "object",
    additionalProperties: false,
    required: ["parent_revision_id"],
    oneOf: [
      { required: ["recipe"], not: { required: ["operations"] } },
      { required: ["operations"], not: { required: ["recipe"] } },
    ],
    properties: {
      parent_revision_id: uuid,
      recipe: ref("PrevisRecipe"),
      operations: {
        type: "array",
        minItems: 1,
        maxItems: 64,
        items: ref("PrevisOperation"),
      },
      views: {
        type: "array",
        maxItems: 8,
        items: ref("PrevisView"),
        description: "Omit to inherit parent views; [] clears them.",
      },
      message: { type: "string", maxLength: 1000, default: "" },
      set_current: { type: "boolean", default: false },
      expected_head_revision_id: uuid,
    },
    description:
      "Parent must belong to this scene. Creates a branch by default without changing the selected revision. set_current=true requires expected_head_revision_id and uses compare-and-swap. Archived scenes must be restored first. Returns {scene, revision}.",
  },
  PrevisForkScene: {
    type: "object",
    additionalProperties: false,
    required: ["revision_id"],
    properties: {
      revision_id: uuid,
      title: { type: "string", minLength: 1, maxLength: 200 },
    },
    description:
      "Copies the specified owned revision into a new scene with an independent initial revision; records forkedFromRevisionId.",
  },
  PrevisDocument: {
    type: "object",
    required: ["scene", "revision"],
    properties: {
      scene: {
        type: "object",
        description:
          "id, title, description, groupId, thumbnailArtifactId, thumbnailRevisionId, thumbnailMode (auto/manual), ownerUserId, version, revisionCount, headRevisionId, forkedFromRevisionId, archivedAt, createdAt, updatedAt. Thumbnails use authenticated artifact downloads. Auto-thumbnail completion does not advance the authoring CAS version.",
      },
      revision: {
        type: "object",
        description:
          "Immutable id, sceneId, parentRevisionId, revisionNumber, recipe, views, checksum, engineVersion, schemaVersion, message, createdBy, createdAt. On a branch response this may differ from scene.headRevisionId.",
      },
    },
  },
};

type ErrorResponses = Record<string, { description: string }>;

export function previsOpenApiPaths(errors: ErrorResponses) {
  const security = [{ bearerAuth: [] }];
  const idempotency = {
    name: "Idempotency-Key",
    in: "header",
    required: false,
    schema: { type: "string", minLength: 1, maxLength: 128 },
    description:
      "Owner-wide mutation key. Same key and request returns the original resource; a different request or operation returns 409. Replay returns that immutable revision with the current scene metadata.",
  };
  const path = (name: string) => ({
    name,
    in: "path",
    required: true,
    schema: uuid,
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
  const body = (name: string) => ({
    required: true,
    content: { "application/json": { schema: ref(name) } },
  });
  const documentResponse = {
    description: "Scene and immutable revision",
    content: { "application/json": { schema: ref("PrevisDocument") } },
  };
  return {
    "/api/v1/previs-groups": {
      get: {
        tags: ["previs"],
        security,
        summary:
          "List owned scene groups with sceneCount (including archived scenes)",
        responses: {
          "200": {
            description:
              "{items: [{id, name, version, sceneCount, createdAt, updatedAt}]}",
          },
          ...errors,
        },
      },
      post: {
        tags: ["previs"],
        security,
        summary: "Create a named scene group",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["name"],
                properties: {
                  name: { type: "string", minLength: 1, maxLength: 80 },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "{group}; duplicate owned names return 409" },
          ...errors,
        },
      },
    },
    "/api/v1/previs-groups/{groupId}": {
      patch: {
        tags: ["previs"],
        security,
        summary: "Rename an owned group with optimistic concurrency",
        parameters: [path("groupId")],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["version", "name"],
                properties: {
                  version: { type: "integer", minimum: 1 },
                  name: { type: "string", minLength: 1, maxLength: 80 },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "{group}; stale version or duplicate name returns 409",
          },
          ...errors,
        },
      },
      delete: {
        tags: ["previs"],
        security,
        summary: "Delete a group, retaining all scenes as ungrouped",
        parameters: [path("groupId")],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["version"],
                properties: { version: { type: "integer", minimum: 1 } },
              },
            },
          },
        },
        responses: {
          "200": {
            description:
              "{deleted: true}; affected scene.version advances; revisions, files and references are retained",
          },
          ...errors,
        },
      },
    },
    "/api/v1/previs/{sceneId}/thumbnail": {
      post: {
        tags: ["previs"],
        security,
        summary:
          "Generate or retry an automatic 320x180 current-revision thumbnail",
        parameters: [path("sceneId")],
        responses: {
          "202": {
            description:
              "Render batch with purpose=thumbnail; deduplicated per revision, hidden from regular batch lists. Poll the batch or scene. Restore automatic mode before requesting when a manual cover is selected.",
          },
          ...errors,
        },
      },
    },
    "/api/v1/previs": {
      get: {
        tags: ["previs"],
        security,
        summary: "List owned lightweight scenes",
        parameters: [
          ...paging,
          {
            name: "search",
            in: "query",
            schema: { type: "string", maxLength: 200 },
          },
          {
            name: "group_id",
            in: "query",
            schema: { type: "string" },
            description:
              "Owned group UUID, or ungrouped; omit to include all groups.",
          },
          {
            name: "status",
            in: "query",
            schema: {
              type: "string",
              enum: ["active", "archived", "all"],
              default: "active",
            },
          },
        ],
        responses: {
          "200": {
            description:
              "{items, total, page, pageSize}; only the current owner's scene metadata.",
          },
          ...errors,
        },
      },
      post: {
        tags: ["previs"],
        security,
        summary: "Create a Crucible scene and initial revision",
        parameters: [idempotency],
        requestBody: body("PrevisCreateScene"),
        responses: { "201": documentResponse, ...errors },
      },
    },
    "/api/v1/previs/{sceneId}": {
      get: {
        tags: ["previs"],
        security,
        summary: "Read a scene and its selected revision",
        parameters: [path("sceneId")],
        responses: { "200": documentResponse, ...errors },
      },
      patch: {
        tags: ["previs"],
        security,
        summary: "Update scene metadata, archive or select a revision",
        parameters: [path("sceneId")],
        requestBody: body("PrevisPatchScene"),
        responses: { "200": documentResponse, ...errors },
      },
    },
    "/api/v1/previs/{sceneId}/revisions": {
      get: {
        tags: ["previs"],
        security,
        summary: "List immutable revision metadata, newest first",
        parameters: [path("sceneId"), ...paging],
        responses: {
          "200": {
            description:
              "{items, total, headRevisionId, page, pageSize}; recipes omitted from list items.",
          },
          ...errors,
        },
      },
      post: {
        tags: ["previs"],
        security,
        summary: "Save a full recipe or atomic operations as a new revision",
        parameters: [path("sceneId"), idempotency],
        requestBody: body("PrevisCreateRevision"),
        responses: { "201": documentResponse, ...errors },
      },
    },
    "/api/v1/previs/{sceneId}/fork": {
      post: {
        tags: ["previs"],
        security,
        summary: "Copy a specific revision into a new scene",
        parameters: [path("sceneId"), idempotency],
        requestBody: body("PrevisForkScene"),
        responses: { "201": documentResponse, ...errors },
      },
    },
    "/api/v1/previs-revisions/{revisionId}": {
      get: {
        tags: ["previs"],
        security,
        summary: "Read a specific immutable revision",
        parameters: [path("revisionId")],
        responses: { "200": documentResponse, ...errors },
      },
    },
    "/api/v1/previs-revisions/{revisionId}/source": {
      get: {
        tags: ["previs"],
        security,
        summary: "Download a versioned JSON scene document",
        parameters: [path("revisionId")],
        responses: {
          "200": {
            description:
              "JSON attachment containing recipe, views, pinned engineVersion, schemaVersion and checksum. The checksum covers canonical {recipe, views, engineVersion, schemaVersion}.",
          },
          ...errors,
        },
      },
    },
  };
}
