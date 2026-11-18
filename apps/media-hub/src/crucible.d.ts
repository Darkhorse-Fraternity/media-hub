declare module "@codepawlhq/crucible" {
  export class CrucibleRenderer {
    constructor(
      canvas: HTMLCanvasElement,
      parts: unknown[],
      options?: Record<string, unknown>,
    );
    resize(): void;
    render(camera: Record<string, unknown>): void;
    updateParts(parts: unknown[]): void;
    dispose(): void;
  }
}
declare module "@codepawlhq/crucible/addons/agent-scene" {
  interface AgentScene {
    readonly revision: number;
    readonly camera: Record<string, unknown>;
    readonly parts: unknown[];
    readonly environment: Record<string, unknown>;
    readonly effects: Record<string, unknown>;
    readonly shadow: Record<string, unknown>;
    apply(
      operations: unknown[],
      options: { expectedRevision: number },
    ): unknown;
    sampleMotion(time: number): unknown;
    exportRecipe(): Record<string, unknown>;
  }
  export function createAgentScene(
    recipe: unknown,
    limits?: Record<string, number>,
  ): AgentScene;
  export function loadAgentSceneModules(input: unknown): Promise<void>;
  export function resolveAgentShadow(
    shadow: Record<string, unknown>,
    lightDirection: unknown,
  ): Record<string, unknown>;
}
