import {
  createAgentScene,
  loadAgentSceneModules,
} from "@codepawlhq/crucible/addons/agent-scene";
import { describe, expect, it } from "vitest";

import {
  filterPrevisMotion,
  previsEngineRecipe,
  previsStarterRecipe,
  resizePrevisMotion,
} from "../lib/previs-editor";

describe("white-model editor motion", () => {
  it("clears the motion section when the final animated object is removed", () => {
    const motion = filterPrevisMotion(
      previsStarterRecipe.motion,
      (track) => track.id !== "subject",
    );
    expect(motion).toBeUndefined();
    expect(() =>
      createAgentScene(
        previsEngineRecipe({
          ...previsStarterRecipe,
          nodes: previsStarterRecipe.nodes.filter(
            (node) => node.id !== "subject",
          ),
          motion,
        }),
      ),
    ).not.toThrow();
  });
  it("retimes all keys without collapsing them and keeps an empty scene static", async () => {
    expect(resizePrevisMotion(undefined, 10)).toBeUndefined();
    const motion = resizePrevisMotion(
      {
        duration: 5,
        tracks: [
          {
            kind: "camera",
            property: "eye",
            keyframes: [
              { time: 0, value: [0, 3, 8] },
              { time: 1, value: [1, 3, 8] },
              { time: 5, value: [5, 3, 8] },
            ],
          },
        ],
      },
      1,
    );
    expect(motion?.tracks[0]?.keyframes.map((key) => key.time)).toEqual([
      0, 0.2, 1,
    ]);
    const recipe = previsEngineRecipe({ ...previsStarterRecipe, motion });
    await loadAgentSceneModules(recipe);
    const scene = createAgentScene(recipe);
    scene.sampleMotion(0.2);
    expect(scene.camera.eye).toEqual([1, 3, 8]);
  });
});
