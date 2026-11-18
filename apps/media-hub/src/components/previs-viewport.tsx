import { useEffect, useRef, useState } from "react";

import type { MediaPrevisRecipe } from "@acme/validators";

import { previsEngineRecipe } from "~/lib/previs-editor";

export function PrevisViewport({
  recipe,
  time,
  label = "场景预览",
}: {
  recipe: MediaPrevisRecipe;
  time: number;
  label?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const sample = useRef<((time: number) => void) | null>(null);
  const timeRef = useRef(time);
  timeRef.current = time;
  useEffect(() => {
    const lifecycle = { disposed: false };
    let dispose: (() => void) | undefined;
    setLoading(true);
    setError("");
    void (async () => {
      const [
        { CrucibleRenderer },
        { createAgentScene, loadAgentSceneModules, resolveAgentShadow },
      ] = await Promise.all([
        import("@codepawlhq/crucible"),
        import("@codepawlhq/crucible/addons/agent-scene"),
      ]);
      const engineRecipe = previsEngineRecipe(recipe);
      await loadAgentSceneModules(engineRecipe);
      const canvas = canvasRef.current;
      if (lifecycle.disposed || !canvas) return;
      const scene = createAgentScene(engineRecipe);
      const environment = scene.environment;
      const renderer = new CrucibleRenderer(canvas, scene.parts, {
        ground: environment.ground !== false,
        world: environment.world === true,
        hdr: true,
        depth: true,
        samples: 1,
        memoryBudgetMiB: 128,
        environment,
        shadowBounds: resolveAgentShadow(
          scene.shadow,
          environment.lightDirection,
        ),
      });
      const draw = (seconds: number) => {
        if (recipe.motion) scene.sampleMotion(seconds);
        renderer.updateParts(scene.parts);
        renderer.resize();
        renderer.render({
          ...scene.camera,
          environment: scene.environment,
          effects: scene.effects,
          exposure: scene.effects.exposure,
          time: seconds,
        });
      };
      const observer = new ResizeObserver(() => draw(timeRef.current));
      observer.observe(canvas);
      sample.current = draw;
      dispose = () => {
        observer.disconnect();
        renderer.dispose();
        sample.current = null;
      };
      draw(timeRef.current);
      setLoading(false);
    })().catch((cause: unknown) => {
      dispose?.();
      if (!lifecycle.disposed) {
        setLoading(false);
        setError(cause instanceof Error ? cause.message : "预览无法启动");
      }
    });
    return () => {
      lifecycle.disposed = true;
      dispose?.();
    };
  }, [recipe]);
  useEffect(() => {
    try {
      sample.current?.(time);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "采样失败");
    }
  }, [time]);
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-slate-900">
      <canvas
        ref={canvasRef}
        aria-label={label}
        className="absolute inset-0 h-full w-full"
      />
      {loading && (
        <div
          role="status"
          className="absolute inset-0 grid place-items-center bg-slate-900/90 text-sm text-slate-300"
        >
          正在打开三维预览…
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="absolute inset-0 grid place-items-center bg-slate-900 p-8 text-center text-sm text-amber-200"
        >
          <div>
            <p>当前浏览器无法显示三维预览</p>
            <p className="mt-2 max-w-md text-xs break-words text-slate-400">
              {error}
            </p>
            <p className="mt-4">仍可保存版本，并在下方发起服务端预览。</p>
          </div>
        </div>
      )}
    </div>
  );
}
