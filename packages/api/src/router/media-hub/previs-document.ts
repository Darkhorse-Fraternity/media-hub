import { createHash } from "node:crypto";
import {
  createAgentScene,
  loadAgentSceneModules,
} from "@codepawlhq/crucible/addons/agent-scene";
import { TRPCError } from "@trpc/server";

import type { MediaPrevisOperation } from "@acme/validators";
import {
  MEDIA_PREVIS_ENGINE_VERSION,
  MEDIA_PREVIS_MAX_RECIPE_BYTES,
  mediaPrevisRecipeSchema,
  mediaPrevisViewsSchema,
} from "@acme/validators";

export function stablePrevisJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stablePrevisJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stablePrevisJson(record[key])}`)
    .join(",")}}`;
}

export function previsChecksum(value: unknown): string {
  return `sha256:${createHash("sha256").update(stablePrevisJson(value)).digest("hex")}`;
}

export const emptyPrevisRecipe = {
  format: "crucible.scene" as const,
  schemaVersion: 1 as const,
  geometries: [],
  materials: [],
  nodes: [],
};

const limits = {
  maxNodes: 64,
  maxGeometries: 32,
  maxMaterials: 32,
  maxVertices: 50_000,
  maxGeometryBytes: 8 * 1024 * 1024,
  maxRecipeBytes: MEDIA_PREVIS_MAX_RECIPE_BYTES,
  maxOperations: 64,
  maxCheckpoints: 1,
};

/** Validate and canonicalize with the pinned CPU authoring API; never start a renderer. */
export async function compilePrevisDocument(input: {
  recipe: unknown;
  operations?: MediaPrevisOperation[];
  views: unknown;
}) {
  try {
    const recipe = mediaPrevisRecipeSchema.parse(input.recipe);
    const views = mediaPrevisViewsSchema.parse(input.views);
    if (
      Buffer.byteLength(
        stablePrevisJson({ recipe, operations: input.operations, views }),
      ) > MEDIA_PREVIS_MAX_RECIPE_BYTES
    ) {
      throw new Error("白模文档超过 256 KiB 上限");
    }
    const engineRecipe = JSON.parse(stablePrevisJson(recipe)) as unknown;
    await loadAgentSceneModules(engineRecipe);
    const scene = createAgentScene(engineRecipe, limits);
    if (input.operations) {
      const operations = JSON.parse(
        stablePrevisJson(input.operations),
      ) as unknown[];
      await loadAgentSceneModules(operations);
      scene.apply(operations, { expectedRevision: scene.revision });
    }
    const canonicalRecipe = scene.exportRecipe();
    // Re-parse the result to enforce the product subset after edits as well as before them.
    mediaPrevisRecipeSchema.parse(canonicalRecipe);
    const canonicalViews = views.map((view) => {
      const camera = {
        ...(canonicalRecipe.camera as Record<string, unknown>),
        ...(JSON.parse(stablePrevisJson(view.camera)) as Record<
          string,
          unknown
        >),
      };
      if (view.camera.focalLength !== undefined) delete camera.fov;
      if (view.camera.fov !== undefined) {
        delete camera.focalLength;
        delete camera.sensorWidth;
      }
      if (
        view.camera.projection === "perspective" &&
        view.camera.orthoScale === undefined
      )
        delete camera.orthoScale;
      const viewScene = createAgentScene(
        { ...emptyPrevisRecipe, camera },
        limits,
      );
      return {
        ...view,
        camera: viewScene.exportRecipe().camera as Record<string, unknown>,
      };
    });
    const document = {
      recipe: canonicalRecipe,
      views: canonicalViews,
      engineVersion: MEDIA_PREVIS_ENGINE_VERSION,
      schemaVersion: 1,
    };
    if (
      Buffer.byteLength(stablePrevisJson(document)) >
      MEDIA_PREVIS_MAX_RECIPE_BYTES
    )
      throw new Error("白模文档超过 256 KiB 上限");
    return { ...document, checksum: previsChecksum(document) };
  } catch (cause) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `白模场景无效：${cause instanceof Error ? cause.message : "无法校验场景"}`,
      cause,
    });
  }
}
