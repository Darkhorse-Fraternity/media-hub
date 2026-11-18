import { describe, expect, it } from "vitest";

import type { MediaPrevisRecipe } from "@acme/validators";
import {
  createMediaPrevisRevisionSchema,
  updateMediaPrevisSceneSchema,
} from "@acme/validators";

import {
  compilePrevisDocument,
  emptyPrevisRecipe,
  previsChecksum,
} from "./previs-document";

const recipe: MediaPrevisRecipe = {
  format: "crucible.scene",
  schemaVersion: 1,
  geometries: [{ id: "box", type: "box", bevel: 0 }],
  materials: [{ id: "grey", color: [0.5, 0.5, 0.5] }],
  nodes: [
    {
      id: "proxy",
      geometry: "box",
      material: "grey",
      translation: [0, 0.5, 0],
    },
  ],
  camera: { eye: [0, 3, 8], target: [0, 0.5, 0], fov: 40 },
};

describe("Crucible scene documents", () => {
  it("treats optional undefined tRPC fields like omitted JSON fields", async () => {
    const original = {
      ...recipe,
      motion: undefined,
      camera: { ...recipe.camera, focalLength: undefined },
    };
    const document = await compilePrevisDocument({
      recipe: original,
      views: [{ id: "front", label: "Front", camera: { fov: undefined } }],
      operations: [{ type: "set-camera", eye: [2, 3, 8], fov: undefined }],
    });
    expect(document.recipe.motion).toBeUndefined();
    expect(document.recipe.camera).toMatchObject({ eye: [2, 3, 8], fov: 40 });
    expect(original.camera).toHaveProperty("focalLength", undefined);
  });
  it("creates a static scene without H3 duration requirements and reimports canonical JSON", async () => {
    const first = await compilePrevisDocument({ recipe, views: [] });
    const second = await compilePrevisDocument({
      recipe: first.recipe,
      views: first.views,
    });
    expect(second).toEqual(first);
    expect(first).toMatchObject({ engineVersion: "0.20.0", schemaVersion: 1 });
    expect(first.recipe.motion).toBeUndefined();
    await expect(
      compilePrevisDocument({ recipe: emptyPrevisRecipe, views: [] }),
    ).resolves.toMatchObject({
      recipe: { nodes: [] },
    });
  });

  it("applies object, camera and motion edits without mutating the source document", async () => {
    const original = structuredClone(recipe);
    const result = await compilePrevisDocument({
      recipe,
      views: [],
      operations: [
        {
          type: "set-node",
          id: "proxy",
          translation: [2, 0.5, 0],
          scale: [2, 1, 1],
        },
        { type: "set-camera", fov: 55 },
        {
          type: "set-motion",
          motion: {
            duration: 2,
            tracks: [
              {
                kind: "node",
                id: "proxy",
                property: "translation",
                keyframes: [
                  { time: 0, value: [2, 0.5, 0] },
                  { time: 2, value: [-2, 0.5, 0] },
                ],
              },
            ],
          },
        },
      ],
    });
    expect(result.recipe.nodes).toEqual([
      expect.objectContaining({
        id: "proxy",
        translation: [2, 0.5, 0],
        scale: [2, 1, 1],
      }),
    ]);
    expect(result.recipe.camera).toMatchObject({ fov: 55 });
    expect(result.recipe.motion).toMatchObject({ duration: 2 });
    expect(recipe).toEqual(original);
  });

  it("validates resource references and final batch state using the actual engine", async () => {
    await expect(
      compilePrevisDocument({
        recipe,
        views: [],
        operations: [{ type: "set-node", id: "proxy", material: "missing" }],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      compilePrevisDocument({
        recipe,
        views: [],
        operations: [
          { type: "remove-material", id: "grey" },
          { type: "add-material", material: { id: "blue", color: [0, 0, 1] } },
          { type: "set-node", id: "proxy", material: "blue" },
        ],
      }),
    ).resolves.toMatchObject({
      recipe: { nodes: [expect.objectContaining({ material: "blue" })] },
    });
  });

  it("stores independent view cameras and includes views in the checksum", async () => {
    const result = await compilePrevisDocument({
      recipe,
      views: [
        { id: "close", label: "Close", camera: { eye: [0, 2, 4], fov: 25 } },
        { id: "side", label: "Side", camera: { eye: [8, 2, 0] } },
        { id: "lens", label: "Lens", camera: { focalLength: 50 } },
        {
          id: "ortho",
          label: "Ortho",
          camera: { projection: "orthographic", orthoScale: 6 },
        },
        { id: "base", label: "Base", camera: {} },
      ],
    });
    expect(result.views[0]?.camera).toMatchObject({ fov: 25 });
    expect(result.views[1]?.camera).toMatchObject({ fov: 40, eye: [8, 2, 0] });
    expect(result.recipe.camera).toMatchObject({ fov: 40, eye: [0, 3, 8] });
    expect(result.views[3]?.camera).toMatchObject({
      projection: "orthographic",
      orthoScale: 6,
    });
    expect(result.views[4]?.camera).toEqual(result.recipe.camera);
    await expect(
      compilePrevisDocument({ recipe: result.recipe, views: result.views }),
    ).resolves.toEqual(result);
    expect(result.checksum).not.toEqual(
      (await compilePrevisDocument({ recipe, views: [] })).checksum,
    );
    await expect(
      compilePrevisDocument({
        recipe,
        views: [
          {
            id: "bad",
            label: "Bad",
            camera: { eye: [0, 0, 0], target: [0, 0, 0] },
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects duplicate view IDs, unsupported scene sections and broken node graphs", async () => {
    await expect(
      compilePrevisDocument({
        recipe,
        views: [
          { id: "same", label: "One", camera: {} },
          { id: "same", label: "Two", camera: {} },
        ],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      compilePrevisDocument({ recipe: { ...recipe, game: {} }, views: [] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      compilePrevisDocument({
        recipe: {
          ...recipe,
          nodes: [{ ...recipe.nodes[0], id: "proxy", parent: "proxy" }],
        },
        views: [],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("bounds the input and computes hashes independent of object key order", async () => {
    await expect(
      compilePrevisDocument({
        recipe: { ...recipe, environment: { unexpected: "x".repeat(270_000) } },
        views: [],
      }),
    ).rejects.toThrow("256 KiB");
    expect(previsChecksum({ a: 1, b: { c: 2, d: 3 } })).toBe(
      previsChecksum({ b: { d: 3, c: 2 }, a: 1 }),
    );
  });
});

it("requires an explicit version choice and one revision editing mode", () => {
  const id = crypto.randomUUID();
  expect(
    createMediaPrevisRevisionSchema.safeParse({
      id,
      parentRevisionId: id,
      recipe,
      operations: [{ type: "set-camera", fov: 50 }],
    }).success,
  ).toBe(false);
  expect(
    createMediaPrevisRevisionSchema.safeParse({
      id,
      parentRevisionId: id,
      recipe,
      setCurrent: true,
    }).success,
  ).toBe(false);
  expect(
    createMediaPrevisRevisionSchema.parse({ id, parentRevisionId: id, recipe })
      .setCurrent,
  ).toBe(false);
  expect(
    updateMediaPrevisSceneSchema.safeParse({
      id,
      version: 1,
      headRevisionId: id,
    }).success,
  ).toBe(false);
});
