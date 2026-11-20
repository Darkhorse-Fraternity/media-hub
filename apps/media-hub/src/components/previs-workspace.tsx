import type { inferRouterOutputs } from "@trpc/server";
import type { ReactNode } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import type { MediaHubAppRouter } from "@acme/api";
import type { MediaPrevisRecipe, MediaPrevisView } from "@acme/validators";
import {
  MEDIA_H3_REFERENCE_VIDEO_MAX_FRAMES,
  mediaPrevisRecipeSchema,
  mediaPrevisViewsSchema,
} from "@acme/validators";

import { authClient } from "~/auth/client";
import {
  filterPrevisMotion,
  movePrevisTrack,
  previsNodeChanges,
  previsStarterRecipe,
  previsTrackOrigin,
  resizePrevisMotion,
} from "~/lib/previs-editor";
import { useTRPC } from "~/lib/trpc";
import {
  PrevisGroupControls,
  PrevisSceneMetadata,
} from "./previs-library-controls";
import { PrevisViewport } from "./previs-viewport";

type Outputs = inferRouterOutputs<MediaHubAppRouter>["mediaHub"]["previs"];
type Document = Outputs["get"];
interface Selection {
  sceneId: string;
  revisionId: string;
  initialDocument?: Document;
}
const fieldClass =
  "w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-sm text-slate-100 focus:border-sky-400 focus:outline-none disabled:opacity-50";
const buttonClass =
  "rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:border-sky-400 hover:text-white focus-visible:outline-2 focus-visible:outline-sky-300 disabled:cursor-not-allowed disabled:opacity-40";
const primaryClass =
  "rounded-lg bg-sky-300 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-200 disabled:cursor-not-allowed disabled:opacity-40";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5 text-xs text-slate-400">
      {label}
      {children}
    </label>
  );
}
function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  disabled,
  step = 0.1,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  disabled?: boolean;
  step?: number | "any";
}) {
  return (
    <Field label={label}>
      <input
        className={fieldClass}
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(event) => {
          const n = event.currentTarget.valueAsNumber;
          if (
            Number.isFinite(n) &&
            (min === undefined || n >= min) &&
            (max === undefined || n <= max)
          )
            onChange(n);
        }}
      />
    </Field>
  );
}
function VectorField({
  label,
  value,
  onChange,
  min,
  disabled,
}: {
  label: string;
  value: number[];
  onChange: (value: [number, number, number]) => void;
  min?: number;
  disabled?: boolean;
}) {
  return (
    <fieldset disabled={disabled}>
      <legend className="mb-2 text-xs text-slate-400">{label}</legend>
      <div className="grid grid-cols-3 gap-2">
        {["X", "Y", "Z"].map((axis, i) => (
          <NumberField
            key={axis}
            label={axis}
            value={value[i] ?? 0}
            min={min}
            onChange={(n) => {
              const next: [number, number, number] = [
                value[0] ?? 0,
                value[1] ?? 0,
                value[2] ?? 0,
              ];
              next[i] = n;
              onChange(next);
            }}
          />
        ))}
      </div>
    </fieldset>
  );
}
function downloadJson(value: unknown, filename: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function PrevisWorkspace() {
  const session = authClient.useSession();
  if (session.isPending)
    return (
      <main className="grid min-h-screen place-items-center bg-slate-950 text-slate-300">
        正在打开白模工作台…
      </main>
    );
  if (!session.data?.user)
    return (
      <main className="grid min-h-screen place-items-center bg-slate-950 p-8 text-slate-200">
        <div>
          <h1 className="text-2xl font-semibold">登录后打开白模工作台</h1>
          <Link to="/" className="mt-4 inline-block text-sky-300">
            返回登录
          </Link>
        </div>
      </main>
    );
  return <AuthenticatedPrevis />;
}

function AuthenticatedPrevis() {
  const trpc = useTRPC(),
    queryClient = useQueryClient();
  const [selection, setSelection] = useState<Selection>({
    sceneId: "",
    revisionId: "",
  });
  const { sceneId, revisionId } = selection;
  const latestSelection = useRef(selection);
  const draftDirty = useRef(false);
  const metadataDirtyRef = useRef(false);
  useLayoutEffect(() => {
    latestSelection.current = selection;
  }, [selection]);
  const select = (next: Selection) => {
    if (next.sceneId === sceneId && next.revisionId === revisionId) return;
    if (
      (draftDirty.current ||
        (next.sceneId !== sceneId && metadataDirtyRef.current)) &&
      !window.confirm("此版本有未保存的修改。要放弃草稿并切换吗？")
    )
      return;
    setSelection(next);
  };
  const openNewScene = (result: Document) => {
    if (latestSelection.current === selection)
      select({ sceneId: result.scene.id, revisionId: "" });
  };
  const [title, setTitle] = useState("新的构图场景");
  const [description, setDescription] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"active" | "archived" | "all">("active");
  const [message, setMessage] = useState("");
  const groups = useQuery(trpc.mediaHub.previs.groups.queryOptions());
  const scenes = useQuery({
    ...trpc.mediaHub.previs.list.queryOptions({
      search,
      status,
      pageSize: 100,
      groupId:
        groupFilter === "all"
          ? undefined
          : groupFilter === "ungrouped"
            ? null
            : groupFilter,
    }),
    refetchInterval: (query) =>
      query.state.data?.items.some(
        (scene) =>
          scene.thumbnailMode === "auto" &&
          scene.thumbnailRevisionId !== scene.headRevisionId &&
          !scene.archivedAt,
      )
        ? 3000
        : false,
  });
  const selected = useQuery({
    ...trpc.mediaHub.previs.get.queryOptions({ id: sceneId }),
    enabled: !!sceneId,
    refetchInterval: (query) =>
      query.state.data?.scene.thumbnailMode === "auto" &&
      query.state.data.scene.thumbnailRevisionId !==
        query.state.data.scene.headRevisionId &&
      !query.state.data.scene.archivedAt
        ? 3000
        : false,
  });
  const history = useQuery({
    ...trpc.mediaHub.previs.revisions.queryOptions({
      id: sceneId,
      pageSize: 100,
    }),
    enabled: !!sceneId,
  });
  // Keep the editor on its loaded revision if a background refresh changes the head.
  const head = selected.data;
  if (!revisionId && head?.scene.id === sceneId)
    setSelection({
      sceneId,
      revisionId: head.revision.id,
      initialDocument: head,
    });
  const revision = useQuery({
    ...trpc.mediaHub.previs.revision.queryOptions({ revisionId }),
    initialData: selection.initialDocument,
    enabled: !!revisionId,
  });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: trpc.mediaHub.previs.pathKey() });
  const create = useMutation(
    trpc.mediaHub.previs.create.mutationOptions({
      onSuccess: async () => {
        setMessage("场景已创建");
        await refresh();
      },
      onError: (error) => setMessage(error.message),
    }),
  );
  const update = useMutation(
    trpc.mediaHub.previs.update.mutationOptions({
      onSuccess: async () => {
        setMessage("场景已更新");
        await refresh();
      },
      onError: (error) => setMessage(error.message),
    }),
  );
  const fork = useMutation(
    trpc.mediaHub.previs.fork.mutationOptions({
      onSuccess: async () => {
        setMessage("已复制为独立场景");
        await refresh();
      },
      onError: (error) => setMessage(error.message),
    }),
  );
  const candidate = revisionId ? revision.data : selected.data;
  const doc = candidate?.scene.id === sceneId ? candidate : undefined;
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 px-5 py-4 lg:px-8">
        <div className="flex items-center gap-4">
          <Link to="/" className="text-sm text-slate-400 hover:text-white">
            导演台
          </Link>
          <span className="h-5 border-l border-slate-700" />
          <h1 className="text-lg font-semibold tracking-tight">白模工作台</h1>
        </div>
        <nav className="flex gap-4 text-sm text-slate-400">
          <Link to="/images" className="hover:text-white">
            图片素材库
          </Link>
          <Link to="/videos" className="hover:text-white">
            视频生成
          </Link>
          <a href="/api/openapi" className="hover:text-white">
            API
          </a>
        </nav>
      </header>
      <div className="grid lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="border-b border-slate-800 p-4 lg:min-h-[calc(100vh-73px)] lg:border-r lg:border-b-0">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              create.mutate(
                {
                  title,
                  description,
                  groupId:
                    groupFilter === "all" || groupFilter === "ungrouped"
                      ? null
                      : groupFilter,
                  recipe: previsStarterRecipe,
                },
                { onSuccess: openNewScene },
              );
            }}
            className="grid gap-2"
          >
            <Field label="场景名称">
              <input
                required
                maxLength={200}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className={fieldClass}
              />
            </Field>
            <Field label="场景简介（可选）">
              <textarea
                aria-label="新场景简介"
                className={`${fieldClass} resize-y`}
                maxLength={2000}
                placeholder="用途、适用镜头、复用说明"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </Field>
            <button className={primaryClass} disabled={create.isPending}>
              新建场景
            </button>
          </form>
          <PrevisGroupControls
            groups={groups.data?.items ?? []}
            value={groupFilter}
            onChange={setGroupFilter}
            onMessage={setMessage}
          />
          {groups.error && (
            <p role="alert" className="mt-2 text-sm text-amber-200">
              {groups.error.message}
            </p>
          )}
          <div className="mt-6 grid gap-2">
            <input
              aria-label="搜索场景"
              placeholder="搜索场景"
              className={fieldClass}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <select
              aria-label="归档筛选"
              className={fieldClass}
              value={status}
              onChange={(event) =>
                setStatus(event.target.value as typeof status)
              }
            >
              <option value="active">使用中的场景</option>
              <option value="archived">已归档</option>
              <option value="all">全部场景</option>
            </select>
          </div>
          {scenes.isPending && (
            <p className="mt-4 text-sm text-slate-400">正在读取场景…</p>
          )}
          {scenes.error && (
            <p role="alert" className="mt-4 text-sm text-amber-200">
              {scenes.error.message}
            </p>
          )}
          <div className="mt-3 flex gap-2 overflow-x-auto lg:grid">
            {scenes.data?.items.map((scene) => (
              <button
                key={scene.id}
                onClick={() => {
                  if (scene.id !== sceneId)
                    select({ sceneId: scene.id, revisionId: "" });
                }}
                className={`min-w-52 overflow-hidden rounded-lg border border-slate-800 p-2 text-left ${scene.id === sceneId ? "border-sky-300 bg-slate-800" : "hover:bg-slate-900"}`}
              >
                {scene.thumbnailArtifactId ? (
                  <img
                    loading="lazy"
                    width={320}
                    height={180}
                    className="mb-2 aspect-video w-full rounded bg-slate-900 object-cover"
                    src={`/api/media-hub/previs-artifacts/${scene.thumbnailArtifactId}`}
                    alt={`场景缩略图：${scene.title}`}
                  />
                ) : (
                  <span className="mb-2 grid aspect-video place-items-center rounded border border-dashed border-slate-700 text-xs text-slate-500">
                    待生成缩略图
                  </span>
                )}
                <span className="block truncate text-sm font-medium">
                  {scene.title}
                </span>
                <span className="mt-1 line-clamp-2 text-xs leading-5 text-slate-400">
                  {scene.description || "暂无简介"}
                </span>
                <span className="mt-1 block text-xs text-slate-500">
                  {scene.revisionCount} 个版本
                  {scene.archivedAt ? " · 已归档" : ""}
                  {scene.groupId
                    ? ` · ${groups.data?.items.find((group) => group.id === scene.groupId)?.name ?? ""}`
                    : " · 未分组"}
                </span>
              </button>
            ))}
          </div>
          {scenes.data?.items.length === 0 && (
            <p className="mt-4 text-sm leading-6 text-slate-400">
              还没有场景。创建一个场景，开始摆放主体和相机。
            </p>
          )}
          {scenes.data && scenes.data.total > 100 && (
            <p className="mt-3 text-xs text-slate-400">
              显示前 100 个场景，请搜索名称缩小范围。
            </p>
          )}
        </aside>
        <section className="min-w-0 p-4 lg:p-6">
          {message && (
            <p
              role="status"
              className="mb-4 rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-sm"
            >
              {message}
            </p>
          )}
          {selected.error && <p role="alert">{selected.error.message}</p>}
          {sceneId && !doc && (
            <p className="p-10 text-slate-400">正在读取场景版本…</p>
          )}
          {!sceneId && (
            <div className="grid min-h-[65vh] place-items-center text-center">
              <div>
                <div className="mx-auto mb-5 grid h-20 w-20 rotate-12 place-items-center rounded-2xl border border-slate-600 text-4xl text-sky-200">
                  ◇
                </div>
                <h2 className="text-2xl font-semibold">先把构图摆出来</h2>
                <p className="mt-3 max-w-sm text-sm leading-7 text-slate-400">
                  用简单物体确定空间、遮挡和运镜。保存版本后，批量导出图片或参考视频。
                </p>
              </div>
            </div>
          )}
          {doc && selected.data && (
            <>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <input
                    key={`${sceneId}:${selected.data.scene.title}`}
                    aria-label="修改场景名称"
                    defaultValue={selected.data.scene.title}
                    maxLength={200}
                    onBlur={(event) => {
                      const value = event.target.value.trim();
                      if (value && value !== selected.data.scene.title)
                        update.mutate({
                          id: sceneId,
                          version: selected.data.scene.version,
                          title: value,
                        });
                    }}
                    className="max-w-full rounded border border-transparent bg-transparent text-xl font-semibold focus:border-sky-300 focus:outline-none"
                  />
                  <p className="mt-1 text-xs text-slate-400">
                    版本 {doc.revision.revisionNumber}
                    {doc.revision.id === selected.data.scene.headRevisionId
                      ? " · 当前选定"
                      : " · 历史版本"}
                    {selected.data.scene.archivedAt ? " · 已归档" : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    className={buttonClass}
                    onClick={() =>
                      fork.mutate(
                        { id: sceneId, revisionId: doc.revision.id },
                        { onSuccess: openNewScene },
                      )
                    }
                    disabled={fork.isPending}
                  >
                    复制场景
                  </button>
                  <button
                    className={buttonClass}
                    onClick={() =>
                      update.mutate({
                        id: sceneId,
                        version: selected.data.scene.version,
                        archived: !selected.data.scene.archivedAt,
                      })
                    }
                    disabled={update.isPending}
                  >
                    {selected.data.scene.archivedAt ? "恢复场景" : "归档"}
                  </button>
                  {doc.revision.id !== selected.data.scene.headRevisionId && (
                    <button
                      className={buttonClass}
                      onClick={() =>
                        update.mutate({
                          id: sceneId,
                          version: selected.data.scene.version,
                          headRevisionId: doc.revision.id,
                          expectedHeadRevisionId:
                            selected.data.scene.headRevisionId ?? undefined,
                        })
                      }
                      disabled={update.isPending}
                    >
                      选为当前版本
                    </button>
                  )}
                </div>
              </div>
              <PrevisSceneMetadata
                key={selected.data.scene.id}
                scene={selected.data.scene}
                groups={groups.data?.items ?? []}
                metadataDirtyRef={metadataDirtyRef}
                pending={update.isPending}
                onSave={(changes) =>
                  update
                    .mutateAsync({
                      id: sceneId,
                      version: selected.data.scene.version,
                      ...changes,
                    })
                    .then(
                      () => true,
                      () => false,
                    )
                }
                onMessage={setMessage}
              />
              <RevisionEditor
                key={`${doc.scene.id}:${doc.revision.id}`}
                document={{ ...doc, scene: selected.data.scene }}
                draftDirty={draftDirty}
                onSaved={async (result) => {
                  queryClient.setQueryData(
                    trpc.mediaHub.previs.revision.queryOptions({
                      revisionId: result.revision.id,
                    }).queryKey,
                    result,
                  );
                  if (result.scene.headRevisionId === result.revision.id) {
                    queryClient.setQueryData(
                      trpc.mediaHub.previs.get.queryOptions({
                        id: result.scene.id,
                      }).queryKey,
                      (cached) =>
                        !cached || cached.scene.version <= result.scene.version
                          ? result
                          : cached,
                    );
                  }
                  setSelection((current) =>
                    current === selection && result.scene.id === current.sceneId
                      ? {
                          sceneId: current.sceneId,
                          revisionId: result.revision.id,
                        }
                      : current,
                  );
                  await refresh();
                }}
                onMessage={setMessage}
              />
              <section className="mt-6 border-t border-slate-800 pt-5">
                <h3 className="text-sm font-semibold">版本历史</h3>
                <div className="mt-3 flex gap-2 overflow-x-auto pb-2">
                  {history.data?.items.map((item) => (
                    <button
                      key={item.id}
                      className={`${buttonClass} min-w-36 text-left ${doc.revision.id === item.id ? "border-sky-300" : ""}`}
                      onClick={() => select({ sceneId, revisionId: item.id })}
                    >
                      <span className="block">
                        v{item.revisionNumber}
                        {item.id === selected.data.scene.headRevisionId
                          ? " · 当前"
                          : ""}
                      </span>
                      <span className="mt-1 block truncate text-xs text-slate-400">
                        {item.message || "未填写修改说明"}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
              <RenderPanel
                key={doc.scene.id}
                onSetCover={(artifactId) =>
                  update.mutate({
                    id: sceneId,
                    version: selected.data.scene.version,
                    thumbnailArtifactId: artifactId,
                  })
                }
                sceneId={doc.scene.id}
                revisionId={doc.revision.id}
                views={mediaPrevisViewsSchema.parse(doc.revision.views)}
                archived={!!selected.data.scene.archivedAt}
                onMessage={setMessage}
              />
            </>
          )}
        </section>
      </div>
    </main>
  );
}

function RevisionEditor({
  document: doc,
  draftDirty,
  onSaved,
  onMessage,
}: {
  document: Document;
  draftDirty: { current: boolean };
  onSaved: (result: Outputs["createRevision"]) => Promise<void>;
  onMessage: (message: string) => void;
}) {
  const trpc = useTRPC();
  const [recipe, setRecipe] = useState(() =>
    mediaPrevisRecipeSchema.parse(doc.revision.recipe),
  );
  const [views, setViews] = useState(() =>
    mediaPrevisViewsSchema.parse(doc.revision.views),
  );
  const [nodeId, setNodeId] = useState(recipe.nodes[0]?.id ?? "");
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [viewId, setViewId] = useState("");
  const [message, setMessage] = useState("");
  const [setCurrent, setSetCurrent] = useState(
    doc.revision.id === doc.scene.headRevisionId,
  );
  const [expectedHead, setExpectedHead] = useState(doc.scene.headRevisionId);
  const [compare, setCompare] = useState(false);
  const [source, setSource] = useState("");
  const [motionDelta, setMotionDelta] = useState(2);
  const [motionSeconds, setMotionSeconds] = useState(
    recipe.motion?.duration ?? 5,
  );
  const parent = useQuery({
    ...trpc.mediaHub.previs.revision.queryOptions({
      revisionId: doc.revision.parentRevisionId ?? doc.revision.id,
    }),
    enabled: compare && !!doc.revision.parentRevisionId,
  });
  const save = useMutation(
    trpc.mediaHub.previs.createRevision.mutationOptions({
      onSuccess: (result) => {
        onMessage("新版本已保存");
        void onSaved(result);
      },
      onError: (error) => onMessage(error.message),
    }),
  );
  const duration = recipe.motion?.duration ?? 0;
  useEffect(() => {
    if (!playing || !duration) return;
    let frame = 0;
    const start = performance.now() - time * 1000;
    const step = (now: number) => {
      const next = (now - start) / 1000;
      setTime(Math.min(next, duration));
      if (next < duration) frame = requestAnimationFrame(step);
      else setPlaying(false);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
    // The playback start is fixed until the play button changes state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, duration]);
  const node = recipe.nodes.find((node) => node.id === nodeId);
  const material = recipe.materials.find(
    (material) => material.id === node?.material,
  );
  const selectedView = views.find((view) => view.id === viewId);
  const shownRecipe = useMemo(
    () =>
      selectedView
        ? {
            ...recipe,
            camera: selectedView.camera,
            motion: filterPrevisMotion(
              recipe.motion,
              (track) => track.kind !== "camera",
            ),
          }
        : recipe,
    [recipe, selectedView],
  );
  const editNode = (patch: Partial<MediaPrevisRecipe["nodes"][number]>) =>
    setRecipe((current) => ({
      ...current,
      nodes: current.nodes.map((item) =>
        item.id === nodeId ? { ...item, ...patch } : item,
      ),
    }));
  type Track = NonNullable<MediaPrevisRecipe["motion"]>["tracks"][number];
  const translationTrack = (track: Track) =>
    track.kind === "node" &&
    track.id === nodeId &&
    track.property === "translation";
  const trackedScale =
    recipe.motion?.tracks.some(
      (track) =>
        track.kind === "node" &&
        track.id === nodeId &&
        track.property === "scale",
    ) ?? false;
  const trackedRotation =
    recipe.motion?.tracks.some(
      (track) =>
        track.kind === "node" &&
        track.id === nodeId &&
        track.property === "rotation",
    ) ?? false;
  const trackedFov = recipe.motion?.tracks.some(
    (track) => track.kind === "camera" && track.property === "fov",
  );
  const selectedNodePosition = previsTrackOrigin(
    recipe.motion,
    translationTrack,
    node?.translation ?? [0, 0, 0],
  );
  const editNodePosition = (translation: [number, number, number]) =>
    setRecipe((current) => ({
      ...current,
      nodes: current.nodes.map((item) =>
        item.id === nodeId ? { ...item, translation } : item,
      ),
      motion: movePrevisTrack(
        current.motion,
        translationTrack,
        previsTrackOrigin(
          current.motion,
          translationTrack,
          current.nodes.find((item) => item.id === nodeId)?.translation ?? [
            0, 0, 0,
          ],
        ),
        translation,
      ),
    }));
  const editCamera = (
    property: "eye" | "target",
    position: [number, number, number],
  ) => {
    const match = (track: Track) =>
      track.kind === "camera" && track.property === property;
    const fallback: [number, number, number] =
      property === "eye" ? [4, 3, 8] : [0, 0.5, 0];
    setRecipe((current) => ({
      ...current,
      camera: { ...current.camera, [property]: position },
      motion: movePrevisTrack(
        current.motion,
        match,
        previsTrackOrigin(
          current.motion,
          match,
          current.camera?.[property] ?? fallback,
        ),
        position,
      ),
    }));
  };
  const changed =
    JSON.stringify(recipe) !==
      JSON.stringify(mediaPrevisRecipeSchema.parse(doc.revision.recipe)) ||
    JSON.stringify(views) !==
      JSON.stringify(mediaPrevisViewsSchema.parse(doc.revision.views));
  const canEdit = !doc.scene.archivedAt;
  useLayoutEffect(() => {
    draftDirty.current = changed || !!source.trim() || !!message.trim();
    return () => {
      draftDirty.current = false;
    };
  }, [changed, draftDirty, source, message]);
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="预览视图"
            value={viewId}
            onChange={(event) => setViewId(event.target.value)}
            className={fieldClass + " !w-auto"}
          >
            <option value="">场景相机</option>
            {views.map((view) => (
              <option key={view.id} value={view.id}>
                {view.label}
              </option>
            ))}
          </select>
          <span className="text-xs text-slate-400">
            {changed ? "有未保存修改" : "已保存"}
          </span>
        </div>
        <div className="flex gap-2">
          <button
            className={buttonClass}
            onClick={() =>
              downloadJson(
                {
                  engineVersion: doc.revision.engineVersion,
                  schemaVersion: 1,
                  recipe,
                  views,
                },
                `previs-v${doc.revision.revisionNumber}.json`,
              )
            }
          >
            下载源码
          </button>
          <button
            className={buttonClass}
            disabled={!doc.revision.parentRevisionId}
            onClick={() => setCompare(!compare)}
          >
            {compare ? "关闭对比" : "与父版本对比"}
          </button>
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0">
          <div
            className={`grid gap-3 ${compare && parent.data ? "md:grid-cols-2" : ""}`}
          >
            <PrevisViewport recipe={shownRecipe} time={time} />
            {compare && parent.data && (
              <PrevisViewport
                recipe={mediaPrevisRecipeSchema.parse(
                  parent.data.revision.recipe,
                )}
                time={Math.min(
                  time,
                  mediaPrevisRecipeSchema.parse(parent.data.revision.recipe)
                    .motion?.duration ?? 0,
                )}
                label="父版本预览"
              />
            )}
          </div>
          {compare && parent.data && (
            <p className="mt-2 text-xs text-slate-400">
              左：正在编辑的版本；右：父版本。对象变化：
              {previsNodeChanges(
                mediaPrevisRecipeSchema.parse(parent.data.revision.recipe),
                recipe,
              )
                .map((change) => `${change.id}（${change.kind}）`)
                .join("、") || "无"}
              。相机、材质及动作可在源码中核对。
            </p>
          )}
          <div className="mt-3 flex items-center gap-3 rounded-lg bg-slate-900 p-3">
            <button
              className={buttonClass}
              disabled={!duration}
              onClick={() => {
                if (time >= duration) setTime(0);
                setPlaying(!playing);
              }}
            >
              {playing ? "暂停" : "播放"}
            </button>
            <input
              aria-label="动作时间"
              className="min-w-0 flex-1 accent-sky-300"
              type="range"
              min={0}
              max={duration || 1}
              step={1 / 24}
              disabled={!duration}
              value={time}
              onChange={(event) => {
                setPlaying(false);
                setTime(Number(event.target.value));
              }}
            />
            <span className="w-24 text-right text-xs text-slate-400 tabular-nums">
              {time.toFixed(2)} / {duration.toFixed(2)} 秒
            </span>
          </div>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <div className="min-w-40 flex-1">
              <Field label="修改说明">
                <input
                  className={fieldClass}
                  value={message}
                  disabled={save.isPending}
                  maxLength={1000}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder="例如：主体右移，拉低机位"
                />
              </Field>
            </div>
            <label className="flex items-center gap-2 py-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={setCurrent}
                disabled={save.isPending}
                onChange={(event) => {
                  setSetCurrent(event.target.checked);
                  if (event.target.checked)
                    setExpectedHead(doc.scene.headRevisionId);
                }}
              />
              选为当前版本
            </label>
            <button
              className={primaryClass}
              disabled={!canEdit || save.isPending}
              onClick={() =>
                save.mutate({
                  id: doc.scene.id,
                  parentRevisionId: doc.revision.id,
                  recipe,
                  views,
                  message,
                  setCurrent,
                  expectedHeadRevisionId: setCurrent
                    ? (expectedHead ?? undefined)
                    : undefined,
                })
              }
            >
              {save.isPending ? "正在保存…" : "保存新版本"}
            </button>
          </div>
        </div>
        <fieldset
          disabled={!canEdit || save.isPending}
          className="min-w-0 space-y-5 rounded-xl border border-slate-800 bg-slate-900/50 p-4 xl:max-h-[720px] xl:overflow-y-auto"
        >
          <div>
            <h3 className="text-sm font-semibold">物体</h3>
            <select
              aria-label="选择物体"
              className={fieldClass + " mt-2"}
              value={nodeId}
              onChange={(event) => setNodeId(event.target.value)}
            >
              {recipe.nodes.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label ?? item.id}
                </option>
              ))}
            </select>
            <div className="mt-2 grid grid-cols-3 gap-1">
              {["box", "sphere", "cylinder"].map((type, i) => (
                <button
                  type="button"
                  key={type}
                  className={buttonClass + " !px-1 !text-xs"}
                  disabled={recipe.nodes.length >= 64}
                  onClick={() => {
                    const id = `object_${crypto.randomUUID().slice(0, 8)}`;
                    setRecipe((current) => ({
                      ...current,
                      geometries: current.geometries.some((g) => g.id === type)
                        ? current.geometries
                        : [
                            ...current.geometries,
                            previsStarterRecipe.geometries.find(
                              (geometry) => geometry.id === type,
                            ) ?? { id: type, type: "box" as const, bevel: 0 },
                          ],
                      materials: current.materials.length
                        ? current.materials
                        : [{ id: "white", color: [0.8, 0.8, 0.8] }],
                      nodes: [
                        ...current.nodes,
                        {
                          id,
                          geometry: type,
                          material: current.materials[0]?.id ?? "white",
                          translation: [0, 0.5, 0],
                        },
                      ],
                    }));
                    setNodeId(id);
                  }}
                >
                  + {["方块", "球体", "柱体"][i]}
                </button>
              ))}
            </div>
          </div>
          {node && (
            <>
              <Field label="物体名称">
                <input
                  className={fieldClass}
                  value={node.label ?? node.id}
                  maxLength={128}
                  onChange={(event) => editNode({ label: event.target.value })}
                />
              </Field>
              <VectorField
                label="位置（米）"
                value={selectedNodePosition}
                onChange={editNodePosition}
              />
              {recipe.motion?.tracks.some(translationTrack) && (
                <p className="text-xs text-slate-400">
                  修改起点会平移整个动作轨迹。
                </p>
              )}
              <VectorField
                label="缩放"
                value={node.scale ?? [1, 1, 1]}
                disabled={trackedScale}
                min={0.001}
                onChange={(scale) => editNode({ scale })}
              />
              <NumberField
                label="水平朝向（度）"
                value={Math.round(
                  (2 *
                    Math.atan2(
                      node.rotation?.[1] ?? 0,
                      node.rotation?.[3] ?? 1,
                    ) *
                    180) /
                    Math.PI,
                )}
                step={1}
                disabled={trackedRotation}
                onChange={(degrees) =>
                  editNode({
                    rotation: [
                      0,
                      Math.sin((degrees * Math.PI) / 360),
                      0,
                      Math.cos((degrees * Math.PI) / 360),
                    ],
                  })
                }
              />
              {(trackedScale || trackedRotation) && (
                <p className="text-xs text-slate-400">
                  带关键帧的缩放或朝向可在场景 JSON 中修改。
                </p>
              )}
              {material && (
                <Field label="基础颜色（共享材质）">
                  <input
                    type="color"
                    aria-label="基础颜色"
                    className="h-9 w-full rounded"
                    value={
                      "#" +
                      (material.color ?? [0.8, 0.8, 0.8])
                        .map((n) =>
                          Math.round(n * 255)
                            .toString(16)
                            .padStart(2, "0"),
                        )
                        .join("")
                    }
                    onChange={(event) => {
                      const value = event.target.value;
                      const color: [number, number, number] = [1, 3, 5].map(
                        (i) => parseInt(value.slice(i, i + 2), 16) / 255,
                      ) as [number, number, number];
                      setRecipe((current) => ({
                        ...current,
                        materials: current.materials.map((item) =>
                          item.id === material.id ? { ...item, color } : item,
                        ),
                      }));
                    }}
                  />
                </Field>
              )}
              <button
                className={buttonClass + " w-full"}
                onClick={() => {
                  setRecipe((current) => ({
                    ...current,
                    nodes: current.nodes
                      .filter((item) => item.id !== nodeId)
                      .map((item) =>
                        item.parent === nodeId
                          ? { ...item, parent: null }
                          : item,
                      ),
                    motion: filterPrevisMotion(
                      current.motion,
                      (track) => track.id !== nodeId,
                    ),
                  }));
                  setNodeId("");
                }}
              >
                移除物体
              </button>
            </>
          )}
          <div className="space-y-3 border-t border-slate-700 pt-4">
            <h3 className="text-sm font-semibold">相机</h3>
            <VectorField
              label="机位（米）"
              value={previsTrackOrigin(
                recipe.motion,
                (track) => track.kind === "camera" && track.property === "eye",
                recipe.camera?.eye ?? [4, 3, 8],
              )}
              onChange={(eye) => {
                setViewId("");
                editCamera("eye", eye);
              }}
            />
            <VectorField
              label="看向（米）"
              value={previsTrackOrigin(
                recipe.motion,
                (track) =>
                  track.kind === "camera" && track.property === "target",
                recipe.camera?.target ?? [0, 0.5, 0],
              )}
              onChange={(target) => {
                setViewId("");
                editCamera("target", target);
              }}
            />
            <NumberField
              label="视野角度"
              disabled={trackedFov}
              value={recipe.camera?.fov ?? 45}
              min={1}
              max={179}
              step={1}
              onChange={(fov) => {
                setViewId("");
                setRecipe((current) => ({
                  ...current,
                  camera: { ...current.camera, focalLength: undefined, fov },
                }));
              }}
            />
            {trackedFov && (
              <p className="text-xs text-slate-400">
                视野由关键帧控制，可在场景 JSON 中修改。
              </p>
            )}
            <button
              className={buttonClass + " w-full"}
              disabled={views.length >= 8}
              onClick={() => {
                const id = `view_${crypto.randomUUID().slice(0, 8)}`;
                setViews((current) => [
                  ...current,
                  {
                    id,
                    label: `机位 ${current.length + 1}`,
                    camera: recipe.camera ?? {
                      eye: [4, 3, 8],
                      target: [0, 0, 0],
                    },
                  },
                ]);
                setViewId(id);
              }}
            >
              保存为视图预设
            </button>
            {selectedView && (
              <button
                className={buttonClass + " w-full"}
                onClick={() => {
                  setViews((current) =>
                    current.filter((view) => view.id !== viewId),
                  );
                  setViewId("");
                }}
              >
                删除当前视图预设
              </button>
            )}
          </div>
          <div className="space-y-3 border-t border-slate-700 pt-4">
            <h3 className="text-sm font-semibold">简单动作与运镜</h3>
            <NumberField
              label="动作时长（秒）"
              value={duration || motionSeconds}
              min={0.1}
              max={30}
              onChange={(seconds) => {
                setTime(0);
                setMotionSeconds(seconds);
                setRecipe((current) => ({
                  ...current,
                  motion: resizePrevisMotion(current.motion, seconds),
                }));
              }}
            />
            <NumberField
              label="沿 X 轴移动（米）"
              value={motionDelta}
              onChange={setMotionDelta}
            />
            <div className="grid grid-cols-2 gap-2">
              <button
                className={buttonClass}
                disabled={!node}
                onClick={() => {
                  if (!node) return;
                  const start = selectedNodePosition;
                  setRecipe((current) => ({
                    ...current,
                    motion: {
                      duration: duration || motionSeconds,
                      loop: false,
                      tracks: [
                        ...(current.motion?.tracks.filter(
                          (track) =>
                            !(
                              track.kind === "node" &&
                              track.id === nodeId &&
                              track.property === "translation"
                            ),
                        ) ?? []),
                        {
                          kind: "node",
                          id: nodeId,
                          property: "translation",
                          keyframes: [
                            { time: 0, value: start },
                            {
                              time: duration || motionSeconds,
                              value: [
                                start[0] + motionDelta,
                                start[1],
                                start[2],
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  }));
                }}
              >
                物体平移
              </button>
              <button
                className={buttonClass}
                onClick={() => {
                  const start = recipe.camera?.eye ?? [4, 3, 8];
                  setRecipe((current) => ({
                    ...current,
                    motion: {
                      duration: duration || motionSeconds,
                      loop: false,
                      tracks: [
                        ...(current.motion?.tracks.filter(
                          (track) =>
                            !(
                              track.kind === "camera" &&
                              track.property === "eye"
                            ),
                        ) ?? []),
                        {
                          kind: "camera",
                          property: "eye",
                          keyframes: [
                            { time: 0, value: start },
                            {
                              time: duration || motionSeconds,
                              value: [
                                start[0] + motionDelta,
                                start[1],
                                start[2],
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  }));
                }}
              >
                相机平移
              </button>
            </div>
            <button
              className={buttonClass + " w-full"}
              onClick={() => {
                setRecipe((current) => ({ ...current, motion: undefined }));
                setPlaying(false);
                setTime(0);
              }}
            >
              清除动作
            </button>
          </div>
        </fieldset>
      </div>
      <details className="mt-4 rounded-lg border border-slate-800 p-3">
        <summary className="cursor-pointer text-sm text-slate-400">
          导入或精修场景 JSON
        </summary>
        <p className="my-3 text-xs text-slate-400">
          支持源码下载中的 recipe 与 views，或直接粘贴 Crucible
          recipe。应用到预览后，点击“保存新版本”。
        </p>
        <textarea
          aria-label="场景 JSON"
          className={fieldClass + " min-h-48 font-mono text-xs"}
          value={source}
          disabled={save.isPending}
          onChange={(event) => setSource(event.target.value)}
        />
        <button
          className={buttonClass + " mt-2"}
          disabled={!canEdit || save.isPending || !source.trim()}
          onClick={() => {
            try {
              const value: unknown = JSON.parse(source);
              const envelope = value as { recipe?: unknown; views?: unknown };
              const parsed = mediaPrevisRecipeSchema.parse(
                envelope.recipe ?? value,
              );
              setRecipe(parsed);
              if (envelope.views)
                setViews(mediaPrevisViewsSchema.parse(envelope.views));
              setNodeId(parsed.nodes[0]?.id ?? "");
              setTime(0);
              setViewId("");
              onMessage("JSON 已应用到草稿，请预览后保存");
            } catch (error) {
              onMessage(
                error instanceof Error ? error.message : "场景 JSON 无效",
              );
            }
          }}
        >
          应用到草稿
        </button>
      </details>
    </section>
  );
}

function RenderPanel({
  sceneId,
  revisionId,
  views,
  archived,
  onMessage,
  onSetCover,
}: {
  sceneId: string;
  revisionId: string;
  views: MediaPrevisView[];
  archived: boolean;
  onMessage: (message: string) => void;
  onSetCover: (artifactId: string) => void;
}) {
  const trpc = useTRPC(),
    queryClient = useQueryClient();
  const [renderId, setRenderId] = useState("");
  const [outputType, setOutputType] = useState<"image" | "video">("image");
  const [profile, setProfile] = useState<
    "preview" | "standard" | "h3_reference"
  >("standard");
  const [viewIds, setViewIds] = useState<string[]>([]);
  const [frames, setFrames] = useState("1");
  const [width, setWidth] = useState(896),
    [height, setHeight] = useState(512);
  const [duration, setDuration] = useState(5);
  const batches = useQuery({
    ...trpc.mediaHub.previs.renders.queryOptions({ id: sceneId, pageSize: 30 }),
    refetchInterval: 3000,
  });
  const create = useMutation(
    trpc.mediaHub.previs.createRender.mutationOptions({
      onSuccess: async (result) => {
        setRenderId(result.id);
        onMessage("渲染批次已创建，固定使用当前查看的已保存版本");
        await queryClient.invalidateQueries({
          queryKey: trpc.mediaHub.previs.renders.pathKey(),
        });
      },
      onError: (error) => onMessage(error.message),
    }),
  );
  return (
    <section className="mt-6 border-t border-slate-800 pt-5">
      <h3 className="font-semibold">导出与渲染</h3>
      <p className="mt-1 text-xs text-slate-400">
        用白模确认机位、构图和摆位。做写实视频时，优先用符合开场的原始实拍图做首帧；缺少合适照片时，从已保存版本导出
        PNG，在图片素材里按该布局做一张写实首帧，再生成视频。
      </p>
      <form
        className="mt-4 grid gap-3 md:grid-cols-4"
        onSubmit={(event) => {
          event.preventDefault();
          const parsedFrames =
            outputType === "image"
              ? frames
                  .split(/[,，\s]+/)
                  .filter(Boolean)
                  .map(Number)
              : undefined;
          create.mutate({
            id: sceneId,
            revisionId,
            outputType,
            profile,
            viewIds: viewIds.filter((id) =>
              views.some((view) => view.id === id),
            ),
            frames: parsedFrames,
            width,
            height,
            durationSeconds: duration,
            fps: 24,
            timelineFps: 24,
            idempotencyKey: crypto.randomUUID(),
          });
        }}
      >
        <Field label="输出">
          <select
            className={fieldClass}
            value={outputType}
            onChange={(event) => {
              setOutputType(event.target.value as typeof outputType);
              if (event.target.value === "image" && profile === "h3_reference")
                setProfile("standard");
            }}
          >
            <option value="image">PNG 图片</option>
            <option value="video">MP4 视频</option>
          </select>
        </Field>
        <Field label="规格">
          <select
            className={fieldClass}
            value={profile}
            onChange={(event) =>
              setProfile(event.target.value as typeof profile)
            }
          >
            <option value="preview">快速预览</option>
            <option value="standard">标准</option>
            {outputType === "video" && (
              <option value="h3_reference">H3 参考视频</option>
            )}
          </select>
        </Field>
        <NumberField
          label="宽度"
          value={width}
          min={64}
          max={1920}
          step={2}
          onChange={setWidth}
        />
        <NumberField
          label="高度"
          value={height}
          min={64}
          max={1920}
          step={2}
          onChange={setHeight}
        />
        {outputType === "image" ? (
          <Field label="采样帧（从 1 开始，24 FPS）">
            <input
              className={fieldClass}
              value={frames}
              onChange={(event) => setFrames(event.target.value)}
              placeholder="1, 25, 49"
            />
          </Field>
        ) : (
          <NumberField
            label="名义时长（秒）"
            value={duration}
            min={profile === "h3_reference" ? 5 : 0.1}
            max={profile === "h3_reference" ? 15 : 30}
            step={profile === "h3_reference" ? 1 : "any"}
            onChange={setDuration}
          />
        )}
        {profile === "h3_reference" && (
          <p className="text-xs text-slate-400 md:col-span-4">
            只有要复刻这段白模动画的运镜或动作时序时，才给 H3
            加入参考视频。请选择 5 秒导出（
            {MEDIA_H3_REFERENCE_VIDEO_MAX_FRAMES} 帧）。
          </p>
        )}
        <fieldset className="md:col-span-2">
          <legend className="mb-2 text-xs text-slate-400">
            批量视图（未选时使用场景相机）
          </legend>
          <div className="flex flex-wrap gap-3">
            {views.map((view) => (
              <label
                key={view.id}
                className="flex items-center gap-1.5 text-sm"
              >
                <input
                  type="checkbox"
                  checked={viewIds.includes(view.id)}
                  onChange={(event) =>
                    setViewIds((current) =>
                      event.target.checked
                        ? [...current, view.id]
                        : current.filter((id) => id !== view.id),
                    )
                  }
                />
                {view.label}
              </label>
            ))}
            {!views.length && (
              <span className="py-2 text-xs text-slate-500">
                可在相机面板保存视图预设
              </span>
            )}
          </div>
        </fieldset>
        <button
          className={primaryClass + " self-end"}
          disabled={archived || create.isPending}
        >
          {create.isPending ? "正在创建…" : "开始渲染"}
        </button>
      </form>
      <div className="mt-4 flex flex-wrap gap-2">
        {batches.data?.items.map((batch, i) => (
          <button
            key={batch.id}
            onClick={() => setRenderId(batch.id)}
            className={
              buttonClass + (batch.id === renderId ? " border-sky-300" : "")
            }
          >
            批次 {batches.data.items.length - i} · {batch.completed}/
            {batch.total} · {renderStatus(batch.status)}
          </button>
        ))}
      </div>
      {batches.error && (
        <p role="alert" className="mt-3 text-amber-200">
          {batches.error.message}
        </p>
      )}
      {renderId && (
        <RenderItems
          renderId={renderId}
          onMessage={onMessage}
          onSetCover={onSetCover}
        />
      )}
    </section>
  );
}
function renderStatus(status: string) {
  return (
    (
      {
        queued: "排队中",
        running: "渲染中",
        succeeded: "已完成",
        partial: "部分完成",
        failed: "失败",
        canceled: "已取消",
        interrupted: "执行中断",
      } as Record<string, string>
    )[status] ?? status
  );
}

function RenderItems({
  renderId,
  onMessage,
  onSetCover,
}: {
  renderId: string;
  onMessage: (message: string) => void;
  onSetCover: (artifactId: string) => void;
}) {
  const trpc = useTRPC(),
    queryClient = useQueryClient();
  const items = useQuery({
    ...trpc.mediaHub.previs.renderItems.queryOptions({ renderId }),
    refetchInterval: (query) =>
      query.state.data?.items.some((item) =>
        ["queued", "running"].includes(item.status),
      )
        ? 2000
        : false,
  });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: trpc.mediaHub.previs.pathKey() });
  const cancel = useMutation(
    trpc.mediaHub.previs.cancelRender.mutationOptions({
      onSuccess: refresh,
      onError: (error) => onMessage(error.message),
    }),
  );
  const retry = useMutation(
    trpc.mediaHub.previs.retryRender.mutationOptions({
      onSuccess: refresh,
      onError: (error) => onMessage(error.message),
    }),
  );
  const addImages = useMutation(
    trpc.mediaHub.previs.importImages.mutationOptions({
      onSuccess: async (result) => {
        onMessage(`${result.assets.length} 张图片已加入素材库`);
        await refresh();
      },
      onError: (error) => onMessage(error.message),
    }),
  );
  const pngIds =
    items.data?.items.flatMap((item) =>
      item.artifact?.contentType === "image/png" ? [item.artifact.id] : [],
    ) ?? [];
  return (
    <div className="mt-4">
      <div className="flex flex-wrap gap-2">
        <button
          className={buttonClass}
          disabled={
            cancel.isPending ||
            !items.data?.items.some((item) =>
              ["queued", "running"].includes(item.status),
            )
          }
          onClick={() => cancel.mutate({ renderId })}
        >
          取消待处理项
        </button>
        <button
          className={buttonClass}
          disabled={
            retry.isPending ||
            !items.data?.items.some((item) =>
              ["failed", "interrupted", "canceled"].includes(item.status),
            )
          }
          onClick={() => retry.mutate({ renderId })}
        >
          重试失败或取消项
        </button>
        <button
          className={buttonClass}
          disabled={!pngIds.length || addImages.isPending}
          onClick={() => addImages.mutate({ renderId, artifactIds: pngIds })}
        >
          PNG 加入图片素材库
        </button>
      </div>
      {items.error && (
        <p role="alert" className="mt-3 text-amber-200">
          {items.error.message}
        </p>
      )}
      <div className="mt-3 grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
        {items.data?.items.map((item) => (
          <article
            key={item.id}
            className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900"
          >
            <div className="flex items-center justify-between gap-2 p-3 text-xs">
              <span>
                #{item.position + 1} · {item.spec.viewId ?? "场景相机"}
                {item.spec.frame ? ` · 帧 ${item.spec.frame}` : ""}
              </span>
              <span className="text-slate-400">
                {renderStatus(item.status)}
                {item.cancelRequestedAt && item.status === "running"
                  ? " · 正在停止"
                  : ""}
              </span>
            </div>
            {item.artifact && (
              <>
                {item.artifact.contentType === "image/png" ? (
                  <img
                    src={`/api/media-hub/previs-artifacts/${item.artifact.id}`}
                    alt={`白模渲染 ${item.position + 1}`}
                    className="aspect-video w-full object-contain"
                  />
                ) : (
                  <video
                    controls
                    preload="metadata"
                    src={`/api/media-hub/previs-artifacts/${item.artifact.id}`}
                    className="aspect-video w-full"
                  />
                )}
                <div className="flex flex-wrap gap-3 p-3 text-xs text-sky-200">
                  <a
                    href={`/api/media-hub/previs-artifacts/${item.artifact.id}?download=1`}
                  >
                    下载
                  </a>
                  {item.artifact.contentType === "image/png" && (
                    <button
                      onClick={() => {
                        if (item.artifact) onSetCover(item.artifact.id);
                      }}
                    >
                      用作场景封面
                    </button>
                  )}
                  {item.artifact.contentType === "video/mp4" &&
                    item.spec.profile === "h3_reference" &&
                    (item.artifact.frameCount >
                    MEDIA_H3_REFERENCE_VIDEO_MAX_FRAMES ? (
                      <span className="text-slate-400">
                        用作 H3 参考时请重新导出 5 秒片段
                      </span>
                    ) : (
                      <button
                        onClick={() => {
                          void navigator.clipboard
                            .writeText(item.artifact?.id ?? "")
                            .then(
                              () =>
                                onMessage(
                                  "产物 ID 已复制，可粘贴到导演台镜头的白模视频参考字段",
                                ),
                              () =>
                                onMessage(
                                  `产物 ID：${item.artifact?.id ?? ""}`,
                                ),
                            );
                        }}
                      >
                        复制视频产物 ID
                      </button>
                    ))}
                  <span className="text-slate-500">
                    {item.artifact.width}×{item.artifact.height} ·{" "}
                    {item.artifact.frameCount} 帧
                  </span>
                </div>
              </>
            )}
            {item.error && (
              <p className="px-3 pb-3 text-xs leading-5 break-words text-amber-200">
                {item.error}
              </p>
            )}
            <details className="border-t border-slate-800 p-3 text-xs text-slate-500">
              <summary className="cursor-pointer">
                执行记录（{item.attempts.length} 次）
              </summary>
              {item.attempts.map((attempt) => (
                <p key={attempt.id} className="mt-2 break-words">
                  第 {attempt.number} 次 · {renderStatus(attempt.status)}
                  {attempt.error ? ` · ${attempt.error}` : ""}
                </p>
              ))}
              {["failed", "interrupted", "canceled"].includes(item.status) && (
                <button
                  className={buttonClass + " mt-2"}
                  disabled={retry.isPending}
                  onClick={() => retry.mutate({ renderId, itemIds: [item.id] })}
                >
                  只重试此项
                </button>
              )}
              {["queued", "running"].includes(item.status) && (
                <button
                  className={buttonClass + " mt-2"}
                  disabled={cancel.isPending}
                  onClick={() =>
                    cancel.mutate({ renderId, itemIds: [item.id] })
                  }
                >
                  只取消此项
                </button>
              )}
            </details>
          </article>
        ))}
      </div>
    </div>
  );
}
