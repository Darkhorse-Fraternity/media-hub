import type { FormEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import type {
  MediaVideoScriptContinuityBible,
  MediaVideoScriptShot,
} from "@acme/validators";
import { analyzeMediaVideoScriptShots } from "@acme/validators";

import { authClient } from "~/auth/client";
import { MediaHubAccountMenu } from "~/components/media-hub-account-menu";
import { resolutionOptions } from "~/lib/generation-resolution";
import { useTRPC } from "~/lib/trpc";

export const Route = createFileRoute("/scripts")({
  component: VideoScriptStudioPage,
  validateSearch: (
    search: Record<string, unknown>,
  ): VideoScriptStudioSearch => ({
    scriptId: typeof search.scriptId === "string" ? search.scriptId : undefined,
  }),
});

type ScriptLanguage = "zh" | "en";
type QualityPreset = "fast" | "balanced" | "quality";
interface VideoScriptStudioSearch {
  scriptId?: string;
}

const EMPTY_CONTINUITY_BIBLE: MediaVideoScriptContinuityBible = {
  characters: "",
  wardrobeAndProps: "",
  locationsAndLighting: "",
  visualRules: "",
};

function emptyShot(position: number): MediaVideoScriptShot {
  return {
    id: crypto.randomUUID(),
    title: `镜头 ${position}`,
    durationSeconds: 10,
    visualDescription: "",
    cameraDirection: "",
    continuity: "",
    soundscape: "",
    music: "N/A",
    dialogues: [],
  };
}

function VideoScriptStudioPage() {
  const sessionQuery = authClient.useSession();
  if (sessionQuery.isPending) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-950 text-sm text-slate-400">
        正在打开脚本制作台…
      </main>
    );
  }
  if (!sessionQuery.data?.user) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-950 p-6 text-slate-100">
        <div className="max-w-md border border-slate-800 bg-slate-900 p-8 text-center">
          <p className="text-sm text-amber-300">PUMPKII SCRIPT STUDIO</p>
          <h1 className="mt-3 text-2xl font-semibold">登录后开始编排镜头</h1>
          <p className="mt-3 text-sm leading-6 text-slate-400">
            脚本、素材和生成任务均按账号隔离。
          </p>
          <Link
            to="/"
            className="mt-6 inline-flex bg-amber-300 px-4 py-2 text-sm font-semibold text-slate-950"
          >
            返回登录
          </Link>
        </div>
      </main>
    );
  }
  return (
    <AuthenticatedVideoScriptStudio
      userName={sessionQuery.data.user.name}
      userEmail={sessionQuery.data.user.email}
      isAdmin={sessionQuery.data.user.role === "admin"}
    />
  );
}

function AuthenticatedVideoScriptStudio({
  userName,
  userEmail,
  isAdmin,
}: {
  userName: string;
  userEmail: string;
  isAdmin: boolean;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { scriptId: linkedScriptId } = Route.useSearch();
  const [selectedScriptId, setSelectedScriptId] = useState<string | null>(
    linkedScriptId ?? null,
  );
  const hydratedScriptIdRef = useRef<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newBrief, setNewBrief] = useState("");
  const [targetDuration, setTargetDuration] = useState(30);
  const [language, setLanguage] = useState<ScriptLanguage>("zh");
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [width, setWidth] = useState(1344);
  const [height, setHeight] = useState(768);
  const [defaultProfile, setDefaultProfile] = useState("");
  const [continuityBible, setContinuityBible] =
    useState<MediaVideoScriptContinuityBible>(EMPTY_CONTINUITY_BIBLE);
  const [shots, setShots] = useState<MediaVideoScriptShot[]>([]);
  const [version, setVersion] = useState(1);
  const [dirty, setDirty] = useState(false);
  const [selectedShotIds, setSelectedShotIds] = useState<string[]>([]);
  const [qualityPreset, setQualityPreset] = useState<QualityPreset>("balanced");
  const [message, setMessage] = useState<string | null>(null);

  const listQuery = useQuery(
    trpc.mediaHub.script.list.queryOptions({ page: 1, pageSize: 100 }),
  );
  const scriptQuery = useQuery({
    ...trpc.mediaHub.script.get.queryOptions({
      id: selectedScriptId ?? "none",
    }),
    enabled: Boolean(selectedScriptId),
    refetchInterval: (query) =>
      query.state.data?.shotJobs.some((job) =>
        ["scheduled", "queued", "waiting_for_gpu", "running"].includes(
          job.status,
        ),
      )
        ? 5_000
        : false,
  });
  const healthQuery = useQuery(
    trpc.mediaHub.generation.providerHealth.queryOptions(undefined, {
      retry: false,
    }),
  );
  const imageQuery = useQuery(
    trpc.mediaHub.image.list.queryOptions({ limit: 100 }),
  );

  const applyScript = useCallback(
    (script: {
      title: string;
      brief: string;
      language: string;
      width: number;
      height: number;
      defaultProfile: string | null;
      continuityBible: MediaVideoScriptContinuityBible;
      shots: MediaVideoScriptShot[];
      version: number;
    }) => {
      setTitle(script.title);
      setBrief(script.brief);
      setLanguage(script.language === "en" ? "en" : "zh");
      setWidth(script.width);
      setHeight(script.height);
      setDefaultProfile(script.defaultProfile ?? "");
      setContinuityBible(script.continuityBible);
      setShots(script.shots);
      setVersion(script.version);
      setDirty(false);
      setSelectedShotIds([]);
    },
    [],
  );

  useEffect(() => {
    if (!linkedScriptId || hydratedScriptIdRef.current === linkedScriptId) {
      return;
    }
    let canceled = false;
    void queryClient
      .fetchQuery(trpc.mediaHub.script.get.queryOptions({ id: linkedScriptId }))
      .then((script) => {
        if (canceled) return;
        applyScript(script);
        hydratedScriptIdRef.current = script.id;
      })
      .catch((error: unknown) => {
        if (canceled) return;
        setMessage(error instanceof Error ? error.message : "读取脚本失败");
      });
    return () => {
      canceled = true;
    };
  }, [applyScript, linkedScriptId, queryClient, trpc]);

  const openScript = async (id: string) => {
    if (dirty && !window.confirm("当前修改尚未保存，仍要切换脚本吗？")) {
      return;
    }
    try {
      const script = await queryClient.fetchQuery(
        trpc.mediaHub.script.get.queryOptions({ id }),
      );
      applyScript(script);
      hydratedScriptIdRef.current = id;
      setSelectedScriptId(id);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "读取脚本失败");
    }
  };

  const refreshScripts = async (id?: string) => {
    await queryClient.invalidateQueries({
      queryKey: trpc.mediaHub.script.list.queryKey(),
    });
    if (id) {
      await queryClient.invalidateQueries({
        queryKey: trpc.mediaHub.script.get.queryKey({ id }),
      });
    }
  };

  const createMutation = useMutation(
    trpc.mediaHub.script.create.mutationOptions(),
  );
  const draftMutation = useMutation(
    trpc.mediaHub.script.draft.mutationOptions(),
  );
  const updateMutation = useMutation(
    trpc.mediaHub.script.update.mutationOptions(),
  );
  const deleteMutation = useMutation(
    trpc.mediaHub.script.delete.mutationOptions(),
  );
  const generateMutation = useMutation(
    trpc.mediaHub.script.generate.mutationOptions(),
  );
  const bridgeMutation = useMutation(
    trpc.mediaHub.script.bridgeLastFrame.mutationOptions(),
  );

  const generating =
    draftMutation.isPending ||
    createMutation.isPending ||
    updateMutation.isPending ||
    generateMutation.isPending ||
    bridgeMutation.isPending;
  const generationProfiles = (healthQuery.data?.profiles ?? []).filter(
    (profile) => profile.kind === "generate",
  );
  const assets = imageQuery.data?.assets ?? [];
  const totalDuration = shots.reduce(
    (total, shot) => total + shot.durationSeconds,
    0,
  );
  const scriptIssues = analyzeMediaVideoScriptShots(shots);
  const jobsByShot = new Map<
    string,
    NonNullable<typeof scriptQuery.data>["shotJobs"]
  >();
  for (const job of scriptQuery.data?.shotJobs ?? []) {
    if (!job.scriptShotId) continue;
    const list = jobsByShot.get(job.scriptShotId) ?? [];
    list.push(job);
    jobsByShot.set(job.scriptShotId, list);
  }

  const markDirty = () => setDirty(true);
  const updateShot = (id: string, patch: Partial<MediaVideoScriptShot>) => {
    setShots((current) =>
      current.map((shot) => (shot.id === id ? { ...shot, ...patch } : shot)),
    );
    markDirty();
  };
  const moveShot = (index: number, offset: -1 | 1) => {
    const target = index + offset;
    if (target < 0 || target >= shots.length) return;
    setShots((current) => {
      const next = [...current];
      const [shot] = next.splice(index, 1);
      if (shot) next.splice(target, 0, shot);
      return next;
    });
    markDirty();
  };
  const removeShot = (id: string) => {
    setShots((current) => current.filter((shot) => shot.id !== id));
    setSelectedShotIds((current) => current.filter((value) => value !== id));
    markDirty();
  };
  const addDialogue = (shot: MediaVideoScriptShot) => {
    updateShot(shot.id, {
      dialogues: [
        ...shot.dialogues,
        {
          id: crypto.randomUUID(),
          atSeconds: Math.min(2, shot.durationSeconds - 0.5),
          speakerId: "S1",
          language,
          text: "",
        },
      ],
    });
  };

  const createBlank = async () => {
    if (!newTitle.trim() || !newBrief.trim()) {
      setMessage("先填写标题和创作简报。");
      return;
    }
    try {
      const script = await createMutation.mutateAsync({
        title: newTitle.trim(),
        brief: newBrief.trim(),
        language,
        continuityBible: EMPTY_CONTINUITY_BIBLE,
        shots: [],
      });
      setSelectedScriptId(script.id);
      applyScript(script);
      hydratedScriptIdRef.current = script.id;
      setNewTitle("");
      setNewBrief("");
      await refreshScripts(script.id);
      setMessage("空白脚本已创建，可以开始添加镜头。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "创建脚本失败");
    }
  };

  const createFromBrief = async () => {
    if (!newBrief.trim()) {
      setMessage("先填写创作简报。");
      return;
    }
    setMessage("正在把简报拆成可生成的 H3 镜头…");
    try {
      const draft = await draftMutation.mutateAsync({
        title: newTitle.trim() || undefined,
        brief: newBrief.trim(),
        language,
        targetDurationSeconds: targetDuration,
      });
      const script = await createMutation.mutateAsync({
        title: newTitle.trim() || draft.title,
        brief: newBrief.trim(),
        language,
        continuityBible: draft.continuityBible,
        shots: draft.shots,
      });
      setSelectedScriptId(script.id);
      applyScript(script);
      hydratedScriptIdRef.current = script.id;
      setNewTitle("");
      setNewBrief("");
      await refreshScripts(script.id);
      setMessage(`脚本已创建，共 ${script.shotCount} 个镜头。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "AI 拆镜失败");
    }
  };

  const persistScript = async () => {
    if (!selectedScriptId) throw new Error("请先选择脚本");
    const updated = await updateMutation.mutateAsync({
      id: selectedScriptId,
      version,
      title,
      brief,
      language,
      width,
      height,
      defaultProfile: defaultProfile || undefined,
      continuityBible,
      shots,
    });
    setVersion(updated.version);
    setDirty(false);
    await refreshScripts(selectedScriptId);
    return updated;
  };

  const saveScript = async (event?: FormEvent) => {
    event?.preventDefault();
    try {
      await persistScript();
      setMessage("脚本已保存。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存脚本失败");
    }
  };

  const generateShots = async () => {
    if (!selectedScriptId || shots.length === 0) return;
    try {
      if (dirty) await persistScript();
      const result = await generateMutation.mutateAsync({
        id: selectedScriptId,
        shotIds: selectedShotIds,
        qualityPreset,
        h3Profile: defaultProfile || undefined,
      });
      setSelectedShotIds([]);
      await refreshScripts(selectedScriptId);
      await queryClient.invalidateQueries({
        queryKey: trpc.mediaHub.generation.list.queryKey(),
      });
      setMessage(`${result.jobs.length} 个镜头已进入 GPU 队列。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "镜头生成失败");
    }
  };

  const deleteScript = async () => {
    if (
      !selectedScriptId ||
      !window.confirm("删除这个脚本项目？已生成的视频任务不会删除。")
    ) {
      return;
    }
    try {
      await deleteMutation.mutateAsync({ id: selectedScriptId });
      setSelectedScriptId(null);
      hydratedScriptIdRef.current = null;
      setDirty(false);
      await refreshScripts();
      setMessage("脚本已删除。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "删除脚本失败");
    }
  };

  const bridgeLastFrame = async (sourceShotId: string) => {
    if (!selectedScriptId) return;
    try {
      const saved = dirty ? await persistScript() : null;
      const result = await bridgeMutation.mutateAsync({
        id: selectedScriptId,
        sourceShotId,
        version: saved?.version ?? version,
      });
      applyScript(result);
      await refreshScripts(selectedScriptId);
      await queryClient.invalidateQueries({
        queryKey: trpc.mediaHub.image.list.queryKey(),
      });
      setMessage("已把末帧存入图片素材，并设为下一镜首帧。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "末帧接力失败");
    }
  };

  return (
    <main className="min-h-screen bg-[linear-gradient(110deg,rgba(245,158,11,0.05),transparent_28%),#020617] p-4 text-slate-100 sm:p-6">
      <div className="mx-auto max-w-[1720px]">
        <header className="relative flex flex-col gap-4 border-b border-slate-800 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="pr-24 sm:pr-28 lg:pr-0">
            <p className="text-sm text-amber-300">Pumpkii Script Studio</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
              先把故事拍明白，再让 GPU 开机。
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
              每个镜头都是 5–15
              秒的独立生成单元。确认画面、台词和连续性后，再逐镜进入 H3 队列。
            </p>
          </div>
          <nav className="flex flex-wrap gap-2" aria-label="创作工具">
            <Link
              to="/"
              className="border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-cyan-400 hover:text-cyan-200"
            >
              快速生成
            </Link>
            <Link
              to="/images"
              className="border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-violet-400 hover:text-violet-200"
            >
              图片素材
            </Link>
          </nav>
          <div className="absolute top-0 right-0 z-50">
            <MediaHubAccountMenu
              user={{ name: userName, email: userEmail }}
              isAdmin={isAdmin}
              onSignedOut={() => window.location.assign("/")}
            />
          </div>
        </header>

        {message && (
          <div className="mt-4 border-l-2 border-amber-300 bg-amber-300/5 px-4 py-3 text-sm text-amber-100">
            {message}
          </div>
        )}

        <div className="mt-5 grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)_320px]">
          <aside className="space-y-5 xl:sticky xl:top-5 xl:self-start">
            <section className="border border-slate-800 bg-slate-900/90 p-4">
              <h2 className="font-semibold">新脚本</h2>
              <div className="mt-4 space-y-3">
                <input
                  value={newTitle}
                  onChange={(event) => setNewTitle(event.target.value)}
                  placeholder="标题（可选）"
                  className="w-full border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-amber-300"
                />
                <textarea
                  value={newBrief}
                  onChange={(event) => setNewBrief(event.target.value)}
                  rows={5}
                  placeholder="故事、受众、人物、必须出现的台词…"
                  className="w-full resize-y border border-slate-700 bg-slate-950 px-3 py-2 text-sm leading-6 outline-none focus:border-amber-300"
                />
                <label className="block text-xs text-slate-400">
                  目标时长 · {targetDuration} 秒
                  <input
                    type="range"
                    min={10}
                    max={120}
                    step={5}
                    value={targetDuration}
                    onChange={(event) =>
                      setTargetDuration(Number(event.target.value))
                    }
                    className="mt-2 w-full accent-amber-300"
                  />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => void createBlank()}
                    disabled={generating}
                    className="border border-slate-700 px-3 py-2 text-sm text-slate-300 disabled:opacity-50"
                  >
                    空白脚本
                  </button>
                  <button
                    type="button"
                    onClick={() => void createFromBrief()}
                    disabled={generating}
                    className="bg-amber-300 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50"
                  >
                    AI 拆镜
                  </button>
                </div>
              </div>
            </section>

            <section className="border-t border-slate-800 pt-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">我的脚本</h2>
                <span className="text-xs text-slate-500">
                  {listQuery.data?.total ?? 0}
                </span>
              </div>
              <div className="mt-3 grid gap-1">
                {listQuery.data?.rows.map((script) => (
                  <button
                    key={script.id}
                    type="button"
                    onClick={() => void openScript(script.id)}
                    className={`border-l-2 px-3 py-3 text-left ${selectedScriptId === script.id ? "border-amber-300 bg-amber-300/5" : "border-slate-800 hover:border-slate-600"}`}
                  >
                    <span className="block truncate text-sm text-slate-200">
                      {script.title}
                    </span>
                    <span className="mt-1 block text-xs text-slate-500">
                      {script.shotCount} 镜 · {script.totalDurationSeconds} 秒
                    </span>
                  </button>
                ))}
                {!listQuery.isPending && listQuery.data?.rows.length === 0 && (
                  <p className="px-3 py-6 text-sm leading-6 text-slate-500">
                    输入简报，让 AI 先给你一版可以逐镜修改的拍摄稿。
                  </p>
                )}
              </div>
            </section>
          </aside>

          <section className="min-w-0 border-x border-slate-800 bg-slate-950/40">
            {!selectedScriptId ? (
              <div className="grid min-h-[620px] place-items-center p-8 text-center text-sm text-slate-500">
                从左侧创建或选择一个脚本。
              </div>
            ) : scriptQuery.isPending ? (
              <div className="grid min-h-[620px] place-items-center text-sm text-slate-500">
                正在装载镜头稿…
              </div>
            ) : (
              <form onSubmit={(event) => void saveScript(event)}>
                <div className="border-b border-slate-800 p-5 sm:p-6">
                  <input
                    value={title}
                    onChange={(event) => {
                      setTitle(event.target.value);
                      markDirty();
                    }}
                    aria-label="脚本标题"
                    className="w-full bg-transparent text-2xl font-semibold tracking-tight outline-none placeholder:text-slate-700"
                    placeholder="未命名脚本"
                  />
                  <textarea
                    value={brief}
                    onChange={(event) => {
                      setBrief(event.target.value);
                      markDirty();
                    }}
                    aria-label="创作简报"
                    rows={2}
                    className="mt-3 w-full resize-y bg-transparent text-sm leading-6 text-slate-400 outline-none placeholder:text-slate-700"
                    placeholder="创作简报"
                  />
                </div>

                <div className="border-b border-slate-800 bg-slate-900/50 px-5 py-4 sm:px-6">
                  <div className="flex items-end justify-between gap-4 text-xs text-slate-500">
                    <span>镜头轨道 · 按时长比例</span>
                    <span>
                      {shots.length} 镜 / {totalDuration} 秒
                    </span>
                  </div>
                  <div className="mt-3 flex h-12 gap-px bg-slate-800">
                    {shots.map((shot, index) => (
                      <button
                        key={shot.id}
                        type="button"
                        onClick={() =>
                          document
                            .getElementById(`shot-${shot.id}`)
                            ?.scrollIntoView({
                              behavior: "smooth",
                              block: "center",
                            })
                        }
                        style={{ flexGrow: shot.durationSeconds }}
                        className="group relative min-w-8 overflow-hidden bg-slate-900 text-left hover:bg-amber-300/10"
                      >
                        <span className="absolute inset-x-2 top-2 truncate text-[10px] text-slate-400 group-hover:text-amber-200">
                          {index + 1}. {shot.title}
                        </span>
                        <span className="absolute right-2 bottom-1 font-mono text-[9px] text-slate-600">
                          {shot.durationSeconds}s
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="divide-y divide-slate-800">
                  {shots.map((shot, index) => {
                    const latestJob = jobsByShot.get(shot.id)?.[0];
                    const shotIssues = scriptIssues.filter(
                      (issue) => issue.shotId === shot.id,
                    );
                    return (
                      <article
                        id={`shot-${shot.id}`}
                        key={shot.id}
                        className="scroll-mt-5 p-5 sm:p-6"
                      >
                        <div className="flex flex-wrap items-center gap-3">
                          <input
                            type="checkbox"
                            checked={selectedShotIds.includes(shot.id)}
                            onChange={(event) =>
                              setSelectedShotIds((current) =>
                                event.target.checked
                                  ? [...current, shot.id]
                                  : current.filter((id) => id !== shot.id),
                              )
                            }
                            aria-label={`选择镜头 ${index + 1}`}
                            className="size-4 accent-amber-300"
                          />
                          <span className="font-mono text-xs text-amber-300">
                            {String(index + 1).padStart(2, "0")}
                          </span>
                          <input
                            value={shot.title}
                            onChange={(event) =>
                              updateShot(shot.id, { title: event.target.value })
                            }
                            className="min-w-44 flex-1 bg-transparent font-medium outline-none"
                            aria-label={`镜头 ${index + 1} 标题`}
                          />
                          {latestJob && (
                            <span
                              className={`border px-2 py-1 text-[10px] ${latestJob.status === "succeeded" ? "border-emerald-400/30 text-emerald-300" : latestJob.status === "failed" ? "border-rose-400/30 text-rose-300" : "border-cyan-400/30 text-cyan-300"}`}
                            >
                              {latestJob.kind === "edit" ? "修改" : "生成"} ·{" "}
                              {latestJob.status}
                            </span>
                          )}
                          {latestJob?.status === "succeeded" && (
                            <Link
                              to="/generations/$jobId/edit"
                              params={{ jobId: latestJob.id }}
                              className="border border-violet-300/30 px-2 py-1 text-[10px] text-violet-200 hover:bg-violet-300/10"
                            >
                              修改视频
                            </Link>
                          )}
                          {latestJob?.status === "succeeded" &&
                            index < shots.length - 1 && (
                              <button
                                type="button"
                                onClick={() => void bridgeLastFrame(shot.id)}
                                disabled={bridgeMutation.isPending}
                                className="border border-amber-300/30 px-2 py-1 text-[10px] text-amber-200 disabled:opacity-40"
                              >
                                末帧 → 下一镜
                              </button>
                            )}
                          <div className="flex gap-1">
                            <button
                              type="button"
                              onClick={() => moveShot(index, -1)}
                              disabled={index === 0}
                              className="px-2 py-1 text-xs text-slate-500 disabled:opacity-20"
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              onClick={() => moveShot(index, 1)}
                              disabled={index === shots.length - 1}
                              className="px-2 py-1 text-xs text-slate-500 disabled:opacity-20"
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              onClick={() => removeShot(shot.id)}
                              className="px-2 py-1 text-xs text-rose-300"
                            >
                              删除
                            </button>
                          </div>
                        </div>

                        <div className="mt-5 grid gap-4 lg:grid-cols-2">
                          <label className="block text-xs text-slate-500 lg:col-span-2">
                            画面与动作
                            <textarea
                              value={shot.visualDescription}
                              onChange={(event) =>
                                updateShot(shot.id, {
                                  visualDescription: event.target.value,
                                })
                              }
                              rows={4}
                              className="mt-2 w-full resize-y border border-slate-800 bg-slate-900/70 px-3 py-2 text-sm leading-6 text-slate-200 outline-none focus:border-amber-300"
                            />
                          </label>
                          <label className="block text-xs text-slate-500">
                            摄影指令
                            <textarea
                              value={shot.cameraDirection}
                              onChange={(event) =>
                                updateShot(shot.id, {
                                  cameraDirection: event.target.value,
                                })
                              }
                              rows={3}
                              className="mt-2 w-full resize-y border border-slate-800 bg-slate-900/70 px-3 py-2 text-sm leading-6 outline-none focus:border-amber-300"
                            />
                          </label>
                          <label className="block text-xs text-slate-500">
                            连续性 / 结束构图
                            <textarea
                              value={shot.continuity}
                              onChange={(event) =>
                                updateShot(shot.id, {
                                  continuity: event.target.value,
                                })
                              }
                              rows={3}
                              className="mt-2 w-full resize-y border border-slate-800 bg-slate-900/70 px-3 py-2 text-sm leading-6 outline-none focus:border-amber-300"
                            />
                          </label>
                          <label className="block text-xs text-slate-500">
                            环境声
                            <input
                              value={shot.soundscape}
                              onChange={(event) =>
                                updateShot(shot.id, {
                                  soundscape: event.target.value,
                                })
                              }
                              className="mt-2 w-full border border-slate-800 bg-slate-900/70 px-3 py-2 text-sm outline-none focus:border-amber-300"
                            />
                          </label>
                          <label className="block text-xs text-slate-500">
                            配乐
                            <input
                              value={shot.music}
                              onChange={(event) =>
                                updateShot(shot.id, {
                                  music: event.target.value,
                                })
                              }
                              className="mt-2 w-full border border-slate-800 bg-slate-900/70 px-3 py-2 text-sm outline-none focus:border-amber-300"
                            />
                          </label>
                        </div>

                        <div className="mt-4 border-l border-slate-700 pl-4">
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-slate-500">
                              H3 原始人声台词
                            </span>
                            <button
                              type="button"
                              onClick={() => addDialogue(shot)}
                              className="text-xs text-cyan-300"
                            >
                              + 台词
                            </button>
                          </div>
                          <div className="mt-2 grid gap-2">
                            {shot.dialogues.map((dialogue) => (
                              <div
                                key={dialogue.id}
                                className="grid gap-2 sm:grid-cols-[70px_72px_minmax(0,1fr)_auto]"
                              >
                                <select
                                  value={dialogue.speakerId}
                                  onChange={(event) =>
                                    updateShot(shot.id, {
                                      dialogues: shot.dialogues.map((line) =>
                                        line.id === dialogue.id
                                          ? {
                                              ...line,
                                              speakerId: event.target
                                                .value as typeof line.speakerId,
                                            }
                                          : line,
                                      ),
                                    })
                                  }
                                  className="border border-slate-800 bg-slate-900 px-2 py-2 text-xs"
                                >
                                  <option>S1</option>
                                  <option>S2</option>
                                  <option>S3</option>
                                  <option>S4</option>
                                </select>
                                <input
                                  type="number"
                                  min={0}
                                  max={Math.max(0, shot.durationSeconds - 0.1)}
                                  step={0.1}
                                  value={dialogue.atSeconds}
                                  onChange={(event) =>
                                    updateShot(shot.id, {
                                      dialogues: shot.dialogues.map((line) =>
                                        line.id === dialogue.id
                                          ? {
                                              ...line,
                                              atSeconds: Number(
                                                event.target.value,
                                              ),
                                            }
                                          : line,
                                      ),
                                    })
                                  }
                                  className="border border-slate-800 bg-slate-900 px-2 py-2 text-xs"
                                  aria-label="台词时间"
                                />
                                <input
                                  value={dialogue.text}
                                  onChange={(event) =>
                                    updateShot(shot.id, {
                                      dialogues: shot.dialogues.map((line) =>
                                        line.id === dialogue.id
                                          ? {
                                              ...line,
                                              text: event.target.value,
                                            }
                                          : line,
                                      ),
                                    })
                                  }
                                  placeholder="逐字台词"
                                  className="border border-slate-800 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-cyan-300"
                                />
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateShot(shot.id, {
                                      dialogues: shot.dialogues.filter(
                                        (line) => line.id !== dialogue.id,
                                      ),
                                    })
                                  }
                                  className="px-2 text-xs text-rose-300"
                                >
                                  ×
                                </button>
                              </div>
                            ))}
                          </div>
                          {shotIssues.length > 0 && (
                            <div className="mt-3 border-l-2 border-amber-300/50 bg-amber-300/5 px-3 py-2 text-xs leading-5 text-amber-100">
                              {shotIssues.map((issue) => (
                                <p
                                  key={`${issue.code}-${issue.dialogueId ?? shot.id}`}
                                >
                                  {issue.message}
                                </p>
                              ))}
                            </div>
                          )}
                        </div>
                      </article>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => {
                      setShots((current) => [
                        ...current,
                        emptyShot(current.length + 1),
                      ]);
                      markDirty();
                    }}
                    disabled={shots.length >= 12}
                    className="w-full px-6 py-5 text-left text-sm text-slate-500 hover:bg-slate-900 hover:text-amber-200 disabled:opacity-30"
                  >
                    + 添加镜头
                  </button>
                </div>
              </form>
            )}
          </section>

          <aside className="space-y-5 xl:sticky xl:top-5 xl:self-start">
            <section className="border border-slate-800 bg-slate-900/90 p-5">
              <h2 className="font-semibold">制作检查器</h2>
              <div className="mt-5 space-y-4">
                <label className="block text-xs text-slate-500">
                  脚本语言
                  <select
                    value={language}
                    onChange={(event) => {
                      setLanguage(event.target.value as ScriptLanguage);
                      markDirty();
                    }}
                    className="mt-2 w-full border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                  >
                    <option value="zh">中文</option>
                    <option value="en">English</option>
                  </select>
                </label>
                <label className="block text-xs text-slate-500">
                  分辨率
                  <select
                    value={`${width}x${height}`}
                    onChange={(event) => {
                      const [nextWidth, nextHeight] = event.target.value
                        .split("x")
                        .map(Number);
                      setWidth(nextWidth ?? 1344);
                      setHeight(nextHeight ?? 768);
                      markDirty();
                    }}
                    className="mt-2 w-full border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                  >
                    {resolutionOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs text-slate-500">
                  默认工作流
                  <select
                    value={defaultProfile}
                    onChange={(event) => {
                      setDefaultProfile(event.target.value);
                      markDirty();
                    }}
                    className="mt-2 w-full border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                  >
                    <option value="">
                      管理员默认 ·{" "}
                      {healthQuery.data?.defaultGenerationProfile ?? "读取中"}
                    </option>
                    {generationProfiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.id}
                        {profile.minimumSteps
                          ? ` · ${profile.minimumSteps} 步`
                          : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs text-slate-500">
                  生成质量
                  <select
                    value={qualityPreset}
                    onChange={(event) =>
                      setQualityPreset(event.target.value as QualityPreset)
                    }
                    className="mt-2 w-full border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                  >
                    <option value="fast">快速</option>
                    <option value="balanced">均衡</option>
                    <option value="quality">高质量</option>
                  </select>
                </label>
              </div>

              <div className="mt-5 border-t border-slate-800 pt-4">
                <h3 className="text-sm font-semibold">连续性设定表</h3>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  这些规则会写入每个 H3 镜头，作为固定制作事实。
                </p>
                <div className="mt-3 grid gap-3">
                  {(
                    [
                      ["characters", "角色身份与外观"],
                      ["wardrobeAndProps", "服装与道具"],
                      ["locationsAndLighting", "场景与灯光"],
                      ["visualRules", "画面风格规则"],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key} className="block text-xs text-slate-500">
                      {label}
                      <textarea
                        value={continuityBible[key]}
                        onChange={(event) => {
                          setContinuityBible((current) => ({
                            ...current,
                            [key]: event.target.value,
                          }));
                          markDirty();
                        }}
                        rows={2}
                        className="mt-1 w-full resize-y border border-slate-800 bg-slate-950 px-3 py-2 text-xs leading-5 text-slate-300 outline-none focus:border-amber-300"
                      />
                    </label>
                  ))}
                </div>
              </div>

              <div className="mt-5 border-t border-slate-800 pt-4 text-xs leading-6 text-slate-500">
                <p>{shots.length} 个镜头</p>
                <p>{totalDuration} 秒总时长</p>
                <p>
                  {shots.reduce(
                    (total, shot) => total + shot.dialogues.length,
                    0,
                  )}{" "}
                  句原始人声台词
                </p>
                <p className={scriptIssues.length > 0 ? "text-amber-200" : ""}>
                  {scriptIssues.length} 条制作预警
                </p>
              </div>

              <div className="mt-5 grid gap-2">
                <button
                  type="button"
                  onClick={() => void saveScript()}
                  disabled={!selectedScriptId || !dirty || generating}
                  className="border border-slate-600 px-4 py-2.5 text-sm text-slate-200 disabled:opacity-30"
                >
                  保存脚本
                </button>
                <button
                  type="button"
                  onClick={() => void generateShots()}
                  disabled={
                    !selectedScriptId || shots.length === 0 || generating
                  }
                  className="bg-amber-300 px-4 py-3 text-sm font-semibold text-slate-950 disabled:opacity-30"
                >
                  {selectedShotIds.length > 0
                    ? `生成选中的 ${selectedShotIds.length} 镜`
                    : `生成全部 ${shots.length} 镜`}
                </button>
                <button
                  type="button"
                  onClick={() => void deleteScript()}
                  disabled={!selectedScriptId || deleteMutation.isPending}
                  className="mt-2 px-4 py-2 text-xs text-rose-300 disabled:opacity-30"
                >
                  删除脚本
                </button>
              </div>
            </section>

            <section className="border-t border-slate-800 pt-4">
              <h2 className="text-sm font-semibold">首帧素材</h2>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                在镜头中选择私有素材作为首帧。当前已加载 {assets.length} 张。
              </p>
              {shots.map((shot, index) => (
                <label
                  key={shot.id}
                  className="mt-3 block text-xs text-slate-500"
                >
                  {index + 1}. {shot.title}
                  <select
                    value={shot.firstFrameAssetId ?? ""}
                    onChange={(event) =>
                      updateShot(shot.id, {
                        firstFrameAssetId: event.target.value || undefined,
                      })
                    }
                    className="mt-1 w-full border border-slate-800 bg-slate-950 px-2 py-2 text-xs text-slate-300"
                  >
                    <option value="">文字生成</option>
                    {assets.map((asset) => (
                      <option key={asset.id} value={asset.id}>
                        {asset.filename}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}
