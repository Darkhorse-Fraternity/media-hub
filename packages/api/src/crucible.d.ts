declare module "@codepawlhq/crucible/addons/agent-scene" {
  interface AgentScene {
    readonly revision: number;
    readonly camera: Record<string, unknown>;
    apply(
      operations: unknown[],
      options: { expectedRevision: number },
    ): unknown;
    exportRecipe(): Record<string, unknown>;
    sampleMotion(time: number): unknown;
  }
  export function createAgentScene(
    recipe: unknown,
    limits?: Record<string, number>,
  ): AgentScene;
  export function loadAgentSceneModules(
    recipeOrOperations: unknown,
  ): Promise<void>;
}
