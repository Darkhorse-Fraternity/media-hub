import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import type { ContentLanguage } from "~/lib/content-language";
import { authClient } from "~/auth/client";
import { ContentLanguageMenu } from "~/components/content-language-menu";
import { MediaHubAccountMenu } from "~/components/media-hub-account-menu";
import {
  contentLanguageStorageKey,
  defaultContentLanguage,
  parseContentLanguage,
} from "~/lib/content-language";
import { formatImageBytes } from "~/lib/reference-image-compression";
import { useTRPC } from "~/lib/trpc";

export const Route = createFileRoute("/images")({
  component: ImageStudioPage,
});

const imageSizes = [
  { label: "方形 · 1024", width: 1024, height: 1024 },
  { label: "横向 · 1344×768", width: 1344, height: 768 },
  { label: "竖向 · 768×1344", width: 768, height: 1344 },
  { label: "HiDream 原生方形 · 2048", width: 2048, height: 2048 },
] as const;

function ImageStudioPage() {
  const sessionQuery = authClient.useSession();
  if (sessionQuery.isPending) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-950 text-sm text-slate-400">
        正在打开图片创作台…
      </main>
    );
  }
  if (!sessionQuery.data?.user) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-950 p-6 text-slate-100">
        <div className="max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-8 text-center">
          <p className="text-sm text-violet-300">PUMPKII IMAGE STUDIO</p>
          <h1 className="mt-3 text-2xl font-semibold">
            先登录，再打开你的素材库
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-400">
            图片素材按用户隔离。请返回视频工作台登录后继续。
          </p>
          <Link
            to="/"
            className="mt-6 inline-flex rounded-xl bg-violet-300 px-4 py-2 text-sm font-semibold text-slate-950"
          >
            返回登录
          </Link>
        </div>
      </main>
    );
  }
  return (
    <AuthenticatedImageStudio
      userId={sessionQuery.data.user.id}
      userName={sessionQuery.data.user.name}
      userEmail={sessionQuery.data.user.email}
      isAdmin={sessionQuery.data.user.role === "admin"}
    />
  );
}

function AuthenticatedImageStudio({
  userId,
  userName,
  userEmail,
  isAdmin,
}: {
  userId: string;
  userName: string;
  userEmail: string;
  isAdmin: boolean;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [sizeIndex, setSizeIndex] = useState(0);
  const [seed, setSeed] = useState("");
  const [outputCount, setOutputCount] = useState(1);
  const [diversity, setDiversity] = useState(50);
  const [editAssetIds, setEditAssetIds] = useState<string[]>([]);
  const [videoAssetIds, setVideoAssetIds] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [contentLanguage, setContentLanguage] = useState<ContentLanguage>(
    defaultContentLanguage,
  );

  useEffect(() => {
    setContentLanguage(
      parseContentLanguage(
        window.localStorage.getItem(contentLanguageStorageKey(userId)),
      ),
    );
  }, [userId]);

  const listQuery = useQuery({
    ...trpc.mediaHub.image.list.queryOptions({ limit: 80 }),
    refetchInterval: (query) => {
      const data = query.state.data;
      return data?.jobs.some((job) =>
        ["queued", "running"].includes(job.status),
      )
        ? 3_000
        : false;
    },
  });
  const healthQuery = useQuery({
    ...trpc.mediaHub.image.providerHealth.queryOptions(),
    retry: false,
  });
  const preferencesQuery = useQuery(trpc.mediaHub.settings.me.queryOptions());
  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: trpc.mediaHub.image.list.queryKey(),
    });
  const createMutation = useMutation(
    trpc.mediaHub.image.create.mutationOptions({
      onSuccess: async (_result, variables) => {
        setMessage(
          `${variables.outputCount} 张图片已进入队列，完成后会自动保存到你的素材库。`,
        );
        await refresh();
      },
      onError: (error) => setMessage(error.message),
    }),
  );
  const optimizePromptMutation = useMutation(
    trpc.mediaHub.ai.optimizeImagePrompt.mutationOptions(),
  );
  const updatePreferencesMutation = useMutation(
    trpc.mediaHub.settings.updateMe.mutationOptions({
      onSuccess: () =>
        queryClient.invalidateQueries({
          queryKey: trpc.mediaHub.settings.me.queryKey(),
        }),
      onError: (error) => setMessage(error.message),
    }),
  );
  const deleteMutation = useMutation(
    trpc.mediaHub.image.deleteAsset.mutationOptions({
      onSuccess: async (_result, input) => {
        setEditAssetIds((current) => current.filter((id) => id !== input.id));
        setVideoAssetIds((current) => current.filter((id) => id !== input.id));
        await refresh();
      },
    }),
  );

  const assets = useMemo(
    () => listQuery.data?.assets ?? [],
    [listQuery.data?.assets],
  );
  const assetById = useMemo(
    () => new Map(assets.map((asset) => [asset.id, asset])),
    [assets],
  );
  const selectedSize = imageSizes[sizeIndex] ?? imageSizes[0];

  useEffect(() => {
    const preferences = preferencesQuery.data;
    if (!preferences) return;
    setContentLanguage(preferences.contentLanguage);
    window.localStorage.setItem(
      contentLanguageStorageKey(userId),
      preferences.contentLanguage,
    );
  }, [preferencesQuery.data, userId]);

  const updateContentLanguage = (language: ContentLanguage) => {
    setContentLanguage(language);
    window.localStorage.setItem(contentLanguageStorageKey(userId), language);
    if (preferencesQuery.data) {
      updatePreferencesMutation.mutate({
        ...preferencesQuery.data,
        contentLanguage: language,
      });
    }
  };

  const optimizePrompt = async () => {
    if (!prompt.trim()) return;
    setMessage("Codex Worker 正在优化图片提示词…");
    try {
      const result = await optimizePromptMutation.mutateAsync({
        prompt: prompt.trim(),
        negativePrompt: negativePrompt.trim() || undefined,
        language: contentLanguage,
        title: title.trim() || undefined,
        width: selectedSize.width,
        height: selectedSize.height,
        referenceImageCount: editAssetIds.length,
      });
      setPrompt(result.text);
      setMessage("图片提示词已优化，可以继续修改或直接生成。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "图片提示词优化失败");
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!prompt.trim()) return;
    const parsedSeed = seed.trim() ? Number(seed) : undefined;
    if (parsedSeed !== undefined && !Number.isSafeInteger(parsedSeed)) {
      setMessage("Seed 必须是安全整数。");
      return;
    }
    await createMutation.mutateAsync({
      title: title.trim() || undefined,
      prompt: prompt.trim(),
      negativePrompt: negativePrompt.trim(),
      width: selectedSize.width,
      height: selectedSize.height,
      seed: parsedSeed,
      outputCount,
      diversity,
      inputAssetIds: editAssetIds,
    });
  };

  const toggleEditAsset = (id: string) => {
    setEditAssetIds((current) => {
      if (current.includes(id)) return current.filter((value) => value !== id);
      if (current.length >= 4) {
        setMessage("一次最多选择 4 张修改参考图。");
        return current;
      }
      return [...current, id];
    });
  };
  const toggleVideoAsset = (id: string) => {
    setVideoAssetIds((current) => {
      if (current.includes(id)) return current.filter((value) => value !== id);
      if (current.length >= 5) {
        setMessage("视频最多使用 5 张图片。");
        return current;
      }
      return [...current, id];
    });
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_15%_0%,rgba(139,92,246,0.12),transparent_34%),#020617] p-4 text-slate-100 sm:p-6">
      <div className="mx-auto max-w-[1500px] space-y-5">
        <header className="relative flex flex-col gap-4 border-b border-slate-800/80 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="pr-24 sm:pr-28 lg:pr-0">
            <p className="font-mono text-[11px] tracking-[0.24em] text-violet-300">
              PUMPKII / USER LIGHT TABLE
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
              从一张静帧，开始一段影像。
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
              用 HiDream 生成或修改图片，结果自动保存到 {userName}{" "}
              的私有素材库。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ContentLanguageMenu
              value={contentLanguage}
              disabled={
                !preferencesQuery.data || updatePreferencesMutation.isPending
              }
              onChange={updateContentLanguage}
            />
            <span
              className={`rounded-full border px-3 py-1.5 font-mono text-[11px] ${
                healthQuery.data?.status === "healthy"
                  ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                  : "border-amber-400/30 bg-amber-400/10 text-amber-300"
              }`}
            >
              HiDream ·{" "}
              {healthQuery.data?.status === "healthy" ? "READY" : "CHECKING"}
            </span>
            <Link
              to="/"
              className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-sm text-slate-300 transition hover:border-cyan-400/50 hover:text-cyan-200"
            >
              视频创作
            </Link>
          </div>
          <div className="absolute top-0 right-0 z-50">
            <MediaHubAccountMenu
              user={{ name: userName, email: userEmail }}
              isAdmin={isAdmin}
              onSignedOut={() => window.location.assign("/")}
            />
          </div>
        </header>

        <section className="overflow-hidden rounded-2xl border border-violet-400/20 bg-slate-900/80 shadow-2xl shadow-violet-950/20">
          <div className="flex flex-col gap-3 border-b border-slate-800 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-mono text-[10px] tracking-[0.2em] text-violet-300">
                SELECTED FOR MOTION
              </p>
              <p className="mt-1 text-sm text-slate-300">
                第 1 张将作为首帧，其余图片作为主体参考。
              </p>
            </div>
            <Link
              to="/"
              search={{ imageAssets: videoAssetIds.join(",") || undefined }}
              disabled={videoAssetIds.length === 0}
              className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                videoAssetIds.length > 0
                  ? "bg-cyan-300 text-slate-950 hover:bg-cyan-200"
                  : "pointer-events-none bg-slate-800 text-slate-500"
              }`}
            >
              用这 {videoAssetIds.length} 张图生成视频 →
            </Link>
          </div>
          <div className="flex min-h-24 gap-3 overflow-x-auto p-4">
            {videoAssetIds.length === 0 ? (
              <p className="self-center text-sm text-slate-500">
                在下方素材卡片勾选“加入视频”。
              </p>
            ) : (
              videoAssetIds.map((id, index) => {
                const asset = assetById.get(id);
                return asset ? (
                  <button
                    key={id}
                    type="button"
                    onClick={() => toggleVideoAsset(id)}
                    className="group relative h-20 w-28 shrink-0 overflow-hidden rounded-xl border border-cyan-300/40 bg-slate-950 focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:outline-none"
                  >
                    <img
                      src={asset.url}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                    <span className="absolute inset-x-0 bottom-0 bg-slate-950/85 px-2 py-1 text-left font-mono text-[10px] text-cyan-200">
                      {index === 0
                        ? "01 / 首帧"
                        : `${String(index + 1).padStart(2, "0")} / 参考`}
                    </span>
                  </button>
                ) : null;
              })
            )}
          </div>
        </section>

        <div className="grid gap-5 xl:grid-cols-[390px_minmax(0,1fr)]">
          <aside className="space-y-5 xl:sticky xl:top-5 xl:self-start">
            <form
              onSubmit={(event) => void submit(event)}
              className="rounded-2xl border border-slate-800 bg-slate-900/95 p-5 shadow-xl"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-mono text-[10px] tracking-[0.18em] text-slate-500">
                    CREATE
                  </p>
                  <h2 className="mt-1 text-lg font-semibold">
                    {editAssetIds.length > 0 ? "参考图修改" : "文字生成图片"}
                  </h2>
                </div>
                <span className="rounded-full bg-violet-400/10 px-3 py-1 text-xs text-violet-200">
                  {editAssetIds.length}/4 参考
                </span>
              </div>

              <div className="mt-5 space-y-4">
                <label className="block text-sm text-slate-300">
                  任务名称（可选）
                  <input
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="产品主视觉"
                    className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 outline-none focus:border-violet-400"
                  />
                </label>
                <div className="text-sm text-slate-300">
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <label htmlFor="image-generation-prompt">
                      {editAssetIds.length > 0 ? "修改指令" : "画面描述"}
                    </label>
                    <button
                      type="button"
                      disabled={
                        !prompt.trim() || optimizePromptMutation.isPending
                      }
                      onClick={() => void optimizePrompt()}
                      className="rounded-lg border border-violet-400/30 bg-violet-400/5 px-3 py-1.5 text-xs font-medium text-violet-200 transition hover:border-violet-300/50 hover:bg-violet-400/10 focus-visible:ring-2 focus-visible:ring-violet-300 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      {optimizePromptMutation.isPending
                        ? "AI 优化中…"
                        : "✦ AI 优化提示词"}
                    </button>
                  </span>
                  <textarea
                    id="image-generation-prompt"
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    required
                    rows={6}
                    placeholder={
                      editAssetIds.length > 0
                        ? "保留人物与构图，把背景改成雨夜东京街道…"
                        : "电影感产品摄影，柔和侧光，深色背景…"
                    }
                    className="mt-2 w-full resize-y rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 leading-6 outline-none focus:border-violet-400"
                  />
                  <span className="mt-2 block text-xs leading-5 text-slate-500">
                    {editAssetIds.length > 0
                      ? "会明确保留参考图中的主体与未要求修改的细节，并补全修改后的光线、材质和环境。"
                      : "会保留原意，并补全主体、构图、光线、材质和画面风格。"}
                  </span>
                </div>
                <label className="block text-sm text-slate-300">
                  排除内容（可选）
                  <input
                    value={negativePrompt}
                    onChange={(event) => setNegativePrompt(event.target.value)}
                    placeholder="文字、水印、重复物体"
                    className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 outline-none focus:border-violet-400"
                  />
                </label>
                <div className="grid grid-cols-[1fr_120px] gap-3">
                  <label className="block text-sm text-slate-300">
                    画幅
                    <select
                      value={sizeIndex}
                      onChange={(event) =>
                        setSizeIndex(Number(event.target.value))
                      }
                      className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 outline-none focus:border-violet-400"
                    >
                      {imageSizes.map((size, index) => (
                        <option key={size.label} value={index}>
                          {size.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm text-slate-300">
                    Seed
                    <input
                      value={seed}
                      onChange={(event) => setSeed(event.target.value)}
                      inputMode="numeric"
                      placeholder="随机"
                      className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 outline-none focus:border-violet-400"
                    />
                  </label>
                </div>

                <div className="rounded-xl border border-slate-700 bg-slate-950 p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm text-slate-300">生成数量</p>
                      <p className="mt-1 text-xs text-slate-500">
                        一个任务最多生成 4 张，结果分别进入素材库。
                      </p>
                    </div>
                    <div
                      className="grid grid-cols-4 gap-1 rounded-xl bg-slate-900 p-1"
                      aria-label="生成数量"
                    >
                      {[1, 2, 3, 4].map((count) => (
                        <button
                          key={count}
                          type="button"
                          aria-pressed={outputCount === count}
                          onClick={() => setOutputCount(count)}
                          className={`h-8 w-9 rounded-lg text-xs font-medium transition ${
                            outputCount === count
                              ? "bg-violet-300 text-slate-950"
                              : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                          }`}
                        >
                          {count}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="mt-4 border-t border-slate-800 pt-3.5">
                    <div className="flex items-center justify-between gap-3">
                      <label
                        htmlFor="image-diversity"
                        className="text-sm text-slate-300"
                      >
                        多样性
                      </label>
                      <output
                        htmlFor="image-diversity"
                        className="min-w-12 rounded-full bg-violet-400/10 px-2.5 py-1 text-center font-mono text-xs text-violet-200"
                      >
                        {diversity}
                      </output>
                    </div>
                    <input
                      id="image-diversity"
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={diversity}
                      disabled={outputCount === 1}
                      onChange={(event) =>
                        setDiversity(Number(event.target.value))
                      }
                      className="mt-3 w-full accent-violet-300 disabled:cursor-not-allowed disabled:opacity-40"
                    />
                    <div className="mt-1 flex justify-between text-[10px] text-slate-600">
                      <span>保持一致</span>
                      <span>变化明显</span>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-slate-500">
                      {outputCount === 1
                        ? "生成 1 张时不应用多样性。"
                        : diversity <= 30
                          ? "主体和构图基本一致，只改变少量细节。"
                          : diversity <= 70
                            ? "会改变视角、构图、光线和环境细节。"
                            : "每张会采用明显不同的视觉表达，但保留核心要求。"}
                    </p>
                  </div>
                </div>

                {editAssetIds.length > 0 && (
                  <div className="flex gap-2 overflow-x-auto rounded-xl bg-slate-950 p-2">
                    {editAssetIds.map((id) => {
                      const asset = assetById.get(id);
                      return asset ? (
                        <button
                          key={id}
                          type="button"
                          onClick={() => toggleEditAsset(id)}
                          className="h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-violet-300/50"
                          aria-label={`移除参考图 ${asset.filename}`}
                        >
                          <img
                            src={asset.url}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        </button>
                      ) : null;
                    })}
                  </div>
                )}

                <p className="rounded-xl border border-violet-400/15 bg-violet-400/5 px-3 py-2.5 text-xs leading-5 text-slate-400">
                  生成完成后，图片会自动进入下方“你的图片素材”。可在那里选择
                  <span className="text-violet-200">用于修改</span> 或
                  <span className="text-cyan-200">加入视频</span>。
                </p>

                <button
                  type="submit"
                  disabled={!prompt.trim() || createMutation.isPending}
                  className="w-full rounded-xl bg-violet-300 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-violet-200 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {createMutation.isPending
                    ? "正在创建…"
                    : editAssetIds.length > 0
                      ? `开始修改 ${outputCount} 张图片`
                      : `开始生成 ${outputCount} 张图片`}
                </button>
                {message && (
                  <p className="text-sm leading-5 text-cyan-200">{message}</p>
                )}
              </div>
            </form>
          </aside>

          <section className="rounded-2xl border border-slate-800 bg-slate-900/55 p-4 sm:p-5">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="font-mono text-[10px] tracking-[0.18em] text-slate-500">
                  PRIVATE LIBRARY
                </p>
                <h2 className="mt-1 text-xl font-semibold">你的图片素材</h2>
              </div>
              <p className="text-xs text-slate-500">
                {assets.length} 张 · 仅当前账号可见
              </p>
            </div>

            {assets.length === 0 ? (
              <div className="mt-5 grid min-h-80 place-items-center rounded-2xl border border-dashed border-slate-800 bg-slate-950/40 p-8 text-center">
                <div>
                  <p className="text-lg font-medium text-slate-300">
                    灯箱还是空的
                  </p>
                  <p className="mt-2 text-sm text-slate-500">
                    在左侧生成第一张图片，完成后会自动出现在这里。
                  </p>
                </div>
              </div>
            ) : (
              <div className="mt-5 columns-1 gap-4 sm:columns-2 lg:columns-3 2xl:columns-4">
                {assets.map((asset) => {
                  const selectedForEdit = editAssetIds.includes(asset.id);
                  const selectedForVideo = videoAssetIds.includes(asset.id);
                  const deleting =
                    deleteMutation.isPending &&
                    deleteMutation.variables.id === asset.id;
                  return (
                    <article
                      key={asset.id}
                      className={`mb-4 break-inside-avoid overflow-hidden rounded-2xl border bg-slate-950 transition ${
                        selectedForVideo
                          ? "border-cyan-300/60 shadow-lg shadow-cyan-950/30"
                          : selectedForEdit
                            ? "border-violet-300/60"
                            : "border-slate-800 hover:border-slate-700"
                      }`}
                    >
                      <div className="group relative">
                        <a
                          href={asset.url}
                          target="_blank"
                          rel="noreferrer"
                          className="block"
                        >
                          <img
                            src={asset.url}
                            alt={asset.filename}
                            loading="lazy"
                            className="w-full bg-slate-900 object-cover"
                          />
                        </a>
                        <button
                          type="button"
                          disabled={deleting}
                          aria-label={`删除素材 ${asset.filename}`}
                          onClick={() => {
                            if (
                              window.confirm(
                                "确定删除这张素材吗？删除后将无法在图片修改或视频生成中使用。",
                              )
                            ) {
                              deleteMutation.mutate({ id: asset.id });
                            }
                          }}
                          className="absolute top-2.5 right-2.5 rounded-lg border border-white/15 bg-slate-950/85 px-2.5 py-1.5 text-[11px] text-slate-200 shadow-lg backdrop-blur-md transition hover:border-rose-300/50 hover:bg-rose-950/85 hover:text-rose-200 focus-visible:ring-2 focus-visible:ring-rose-300 focus-visible:outline-none disabled:cursor-wait disabled:opacity-60 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                        >
                          {deleting ? "删除中…" : "删除"}
                        </button>
                      </div>
                      <div className="space-y-3 p-3">
                        <div>
                          <p className="truncate text-xs font-medium text-slate-200">
                            {asset.filename}
                          </p>
                          <p className="mt-1 font-mono text-[10px] text-slate-500">
                            {asset.width && asset.height
                              ? `${asset.width}×${asset.height} · `
                              : ""}
                            {formatImageBytes(asset.sizeBytes)} ·{" "}
                            {asset.origin === "upload" ? "上传" : "HiDream"}
                          </p>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => toggleEditAsset(asset.id)}
                            className={`rounded-lg border px-2 py-2 text-xs transition ${
                              selectedForEdit
                                ? "border-violet-300 bg-violet-300 text-slate-950"
                                : "border-slate-700 text-slate-300 hover:border-violet-400/60"
                            }`}
                          >
                            {selectedForEdit ? "已作参考" : "用于修改"}
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleVideoAsset(asset.id)}
                            className={`rounded-lg border px-2 py-2 text-xs transition ${
                              selectedForVideo
                                ? "border-cyan-300 bg-cyan-300 text-slate-950"
                                : "border-slate-700 text-slate-300 hover:border-cyan-400/60"
                            }`}
                          >
                            {selectedForVideo ? "已加入视频" : "加入视频"}
                          </button>
                        </div>
                        <div className="flex items-center border-t border-slate-800 pt-2 text-[11px]">
                          <a
                            href={`${asset.url}?download=1`}
                            className="text-slate-400 hover:text-cyan-200"
                          >
                            下载
                          </a>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
