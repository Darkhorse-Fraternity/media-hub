import {
  createAgentScene,
  loadAgentSceneModules,
} from "@codepawlhq/crucible/addons/agent-scene";
import { describe, expect, it } from "vitest";

import type { MediaPrevisRenderSpec } from "@acme/db/schema";

import { compilePrevisDocument } from "./previs-document";
import { prepareCrucibleRenderRecipe } from "./previs-render-engine";

const spec: MediaPrevisRenderSpec = {
  outputType: "image",
  profile: "standard",
  viewId: null,
  camera: null,
  sampleTime: 1,
  frame: 25,
  width: 384,
  height: 224,
  fps: 24,
  frameCount: 1,
  nominalDurationSeconds: 0,
  durationSeconds: 0,
  engineVersion: "0.20.0",
};
describe("Crucible render document adaptation", () => {
  it("round-trips canonical automatic fog without mutating the saved source", async () => {
    const source = await compilePrevisDocument({
      recipe: { format: "crucible.scene", schemaVersion: 1, nodes: [] },
      views: [],
    });
    const prepared = prepareCrucibleRenderRecipe(source.recipe, spec);
    expect(prepared.recipe.environment).not.toHaveProperty("fogDensity");
    expect(source.recipe.environment).toHaveProperty("fogDensity", null);
    expect(createAgentScene(prepared.recipe).exportRecipe()).toEqual(
      source.recipe,
    );
  });

  it("keeps named views independent while the scene camera has a motion track", async () => {
    const source = await compilePrevisDocument({
      recipe: {
        format: "crucible.scene",
        schemaVersion: 1,
        nodes: [],
        camera: { eye: [0, 3, 8], target: [0, 0, 0] },
        motion: {
          duration: 5,
          tracks: [
            {
              kind: "camera",
              property: "eye",
              keyframes: [
                { time: 0, value: [0, 3, 8] },
                { time: 5, value: [5, 3, 8] },
              ],
            },
          ],
        },
      },
      views: [],
    });
    const camera = { eye: [8, 3, 0], target: [0, 0, 0] };
    const fixed = prepareCrucibleRenderRecipe(source.recipe, {
      ...spec,
      viewId: "side",
      camera,
    });
    await loadAgentSceneModules(fixed.recipe);
    const fixedScene = createAgentScene(fixed.recipe);
    expect(fixed.recipe.motion).toBeUndefined();
    expect(fixedScene.camera.eye).toEqual(camera.eye);
    const animated = prepareCrucibleRenderRecipe(source.recipe, spec);
    await loadAgentSceneModules(animated.recipe);
    const animatedScene = createAgentScene(animated.recipe);
    animatedScene.sampleMotion(1);
    expect(animatedScene.camera.eye).toEqual([1, 3, 8]);
    animatedScene.sampleMotion(4);
    animatedScene.sampleMotion(1);
    expect(animatedScene.camera.eye).toEqual([1, 3, 8]);
  });

  it("records H3 end padding and holds the final authored pose", async () => {
    const source = await compilePrevisDocument({
      recipe: {
        format: "crucible.scene",
        schemaVersion: 1,
        nodes: [],
        camera: { eye: [0, 3, 8], target: [0, 0, 0] },
        motion: {
          duration: 5,
          tracks: [
            {
              kind: "camera",
              property: "eye",
              keyframes: [
                { time: 0, value: [0, 3, 8] },
                { time: 5, value: [5, 3, 8] },
              ],
            },
          ],
        },
      },
      views: [],
    });
    const prepared = prepareCrucibleRenderRecipe(source.recipe, {
      ...spec,
      outputType: "video",
      profile: "h3_reference",
      sampleTime: 0,
      nominalDurationSeconds: 5,
      durationSeconds: 124 / 24,
      frameCount: 124,
    });
    await loadAgentSceneModules(prepared.recipe);
    const scene = createAgentScene(prepared.recipe);
    scene.sampleMotion(123 / 24);
    expect(scene.camera.eye).toEqual([5, 3, 8]);
    expect(prepared.padding).toBeCloseTo(1 / 6);
    expect(source.recipe.motion).toHaveProperty("duration", 5);
  });
});
