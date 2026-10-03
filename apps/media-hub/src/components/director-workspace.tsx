import { Link } from "@tanstack/react-router";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@acme/ui/alert-dialog";
import {
  MEDIA_H3_SCRIPT_SHOT_SECONDS,
  MEDIA_H3_SCRIPT_TARGET_DURATIONS,
} from "@acme/validators";

import type {
  QualityPreset,
  ScriptLanguage,
  ScriptTargetDuration,
} from "~/lib/video-script-studio-state";
import { authClient } from "~/auth/client";
import { DirectorStage } from "~/components/director-stage";
import { MediaHubAccountMenu } from "~/components/media-hub-account-menu";
import {
  LoginScreen,
  SessionLoadingScreen,
} from "~/components/media-hub-login";
import { useVideoScriptStudio } from "~/hooks/use-video-script-studio";
import { resolutionOptions } from "~/lib/generation-resolution";
import { emptyShot } from "~/lib/video-script-studio-state";

export function DirectorWorkspace({
  initialScriptId,
  imageAssetIds = [],
}: {
  initialScriptId?: string;
  imageAssetIds?: string[];
}) {
  const sessionQuery = authClient.useSession();
  if (sessionQuery.isPending) return <SessionLoadingScreen />;
  if (!sessionQuery.data?.user) {
    return <LoginScreen onSuccess={() => void sessionQuery.refetch()} />;
  }

  return (
    <AuthenticatedVideoScriptStudio
      key={`${sessionQuery.data.user.id}:${initialScriptId ?? "new"}`}
      initialScriptId={initialScriptId}
      imageAssetIds={imageAssetIds}
      userName={sessionQuery.data.user.name}
      userEmail={sessionQuery.data.user.email}
      isAdmin={sessionQuery.data.user.role === "admin"}
    />
  );
}

function AuthenticatedVideoScriptStudio({
  initialScriptId,
  imageAssetIds,
  userName,
  userEmail,
  isAdmin,
}: {
  initialScriptId?: string;
  imageAssetIds: string[];
  userName: string;
  userEmail: string;
  isAdmin: boolean;
}) {
  const {
    selectedScriptId,
    newTitle,
    setNewTitle,
    newBrief,
    setNewBrief,
    targetDuration,
    setTargetDuration,
    language,
    setLanguage,
    title,
    setTitle,
    brief,
    setBrief,
    copy,
    setCopy,
    copyStatus,
    setCopyStatus,
    width,
    setWidth,
    height,
    setHeight,
    defaultProfile,
    setDefaultProfile,
    continuityBible,
    setContinuityBible,
    shots,
    setShots,
    dirty,
    selectedShotIds,
    setSelectedShotIds,
    qualityPreset,
    setQualityPreset,
    message,
    imageImportError,
    importedImages,
    setMessage,
    animaticVideoUrl,
    scriptQuery,
    healthQuery,
    refreshScripts,
    deleteMutation,
    bridgeMutation,
    generating,
    generationProfiles,
    assets,
    totalDuration,
    scriptIssues,
    jobsByShot,
    allShotsSucceeded,
    markDirty,
    updateShot,
    moveShot,
    removeShot,
    addDialogue,
    createBlank,
    createFromBrief,
    approveCopy,
    createFrameCandidates,
    selectFrameCandidate,
    saveScript,
    generateShots,
    selectTake,
    saveShotEdit,
    generateShotCaptions,
    createAnimatic,
    assembleVideo,
    deleteScript,
    bridgeLastFrame,
  } = useVideoScriptStudio(initialScriptId, imageAssetIds);
  return (
    <main className="min-h-dvh bg-slate-950 p-4 text-slate-100 sm:p-6">
      <div className="mx-auto max-w-[1720px]">
        <header className="relative flex flex-col gap-4 border-b border-slate-800 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="pr-24 sm:pr-28 lg:pr-0">
            <p className="text-sm text-amber-300">Pumpkii 导演台</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
              导演台
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
              默认按 15 秒拆成独立 H3
              生成单元，仅最后一个尾镜头可按剩余时长缩短。
              确认画面、台词和连续性后，逐镜生成、预览、修改并选定成片版本。
            </p>
          </div>
          <nav className="flex flex-wrap gap-2" aria-label="创作工具">
            {selectedScriptId && (
              <Link
                to="/"
                className="border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-amber-300 hover:text-amber-200"
              >
                新建脚本
              </Link>
            )}
            <Link
              to="/scripts/history"
              className="border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-amber-300 hover:text-amber-200"
            >
              历史脚本
            </Link>
            <Link
              to="/videos"
              className="border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-amber-300"
            >
              作品库
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

        <div
          className={`mt-5 grid gap-5 ${selectedScriptId ? "xl:grid-cols-[minmax(0,1fr)_320px]" : "xl:grid-cols-[360px_minmax(0,1fr)_320px]"}`}
        >
          {!selectedScriptId && (
            <aside className="space-y-5 xl:sticky xl:top-5 xl:self-start">
              <section className="border border-slate-800 bg-slate-900/90 p-4">
                <div className="flex items-center justify-between gap-4">
                  <h2 className="font-semibold">新脚本</h2>
                  <Link
                    to="/scripts/history"
                    className="text-xs text-amber-200 hover:text-amber-100"
                  >
                    查看历史
                  </Link>
                </div>
                {imageImportError && (
                  <p role="alert" className="mt-3 text-sm text-rose-300">
                    {imageImportError}
                  </p>
                )}
                {importedImages.length > 0 && (
                  <p role="status" className="mt-3 text-sm text-amber-200">
                    已带入 {importedImages.length}{" "}
                    张首帧素材，将按顺序分配给镜头。
                  </p>
                )}
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
                    <select
                      value={targetDuration}
                      onChange={(event) =>
                        setTargetDuration(
                          Number(event.target.value) as ScriptTargetDuration,
                        )
                      }
                      className="mt-2 w-full border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 outline-none focus:border-amber-300"
                    >
                      {MEDIA_H3_SCRIPT_TARGET_DURATIONS.map((duration) => (
                        <option key={duration} value={duration}>
                          {duration} 秒 · {duration / 15} 镜
                        </option>
                      ))}
                    </select>
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
            </aside>
          )}

          <section className="min-w-0 border-x border-slate-800 bg-slate-950/40">
            {!selectedScriptId ? (
              <div className="grid min-h-[620px] place-items-center p-8 text-center text-sm text-slate-500">
                从左侧创建脚本，或前往历史脚本继续制作。
              </div>
            ) : scriptQuery.isPending ? (
              <div className="grid min-h-[620px] place-items-center text-sm text-slate-500">
                正在装载镜头稿…
              </div>
            ) : (
              <form onSubmit={(event) => void saveScript(event)}>
                <fieldset disabled={generating}>
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

                  <section className="border-b border-slate-800 bg-slate-900/30 p-5 sm:p-6">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <p className="font-mono text-[10px] tracking-[0.24em] text-cyan-300">
                          01 · COPY LOCK
                        </p>
                        <h2 className="mt-2 text-lg font-semibold">成片文案</h2>
                        <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">
                          先确认故事、节奏和台词。修改已确认文案会自动退回待确认，避免旧首帧继续流入制作。
                        </p>
                      </div>
                      <span
                        className={`border px-3 py-1 text-xs ${copyStatus === "approved" ? "border-emerald-400/30 text-emerald-300" : "border-amber-300/30 text-amber-200"}`}
                      >
                        {copyStatus === "approved" ? "已确认" : "待确认"}
                      </span>
                    </div>
                    <textarea
                      value={copy}
                      onChange={(event) => {
                        setCopy(event.target.value);
                        setCopyStatus("draft");
                        markDirty();
                      }}
                      rows={7}
                      placeholder="完整故事文案、旁白、必须保留的台词与节奏说明…"
                      className="mt-4 w-full resize-y border border-slate-700 bg-slate-950 px-4 py-3 text-sm leading-7 text-slate-200 outline-none focus:border-cyan-300"
                    />
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                      <span className="text-xs text-slate-600">
                        {copy.length.toLocaleString()} / 20,000 字符
                      </span>
                      <button
                        type="button"
                        onClick={() => void approveCopy()}
                        disabled={
                          !copy.trim() ||
                          (copyStatus === "approved" && !dirty) ||
                          generating
                        }
                        className="bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-30"
                      >
                        确认文案并锁定
                      </button>
                    </div>
                  </section>

                  <DirectorStage
                    shots={shots}
                    jobsByShot={jobsByShot}
                    assembledJob={
                      scriptQuery.data?.assembledJob
                        ? {
                            ...scriptQuery.data.assembledJob,
                            isCurrent:
                              !dirty && scriptQuery.data.assembledJob.isCurrent,
                          }
                        : null
                    }
                    language={language}
                    busy={generating}
                    canAssemble={allShotsSucceeded}
                    onSelectTake={selectTake}
                    onGenerateShot={async (shotId) => generateShots(shotId)}
                    onAssemble={assembleVideo}
                    onSaveShotEdit={saveShotEdit}
                    onChangeShotEdit={updateShot}
                    onGenerateCaptions={generateShotCaptions}
                    onCreateAnimatic={createAnimatic}
                    animaticVideoUrl={animaticVideoUrl}
                    onEditCreated={async () => {
                      if (selectedScriptId)
                        await refreshScripts(selectedScriptId);
                      setMessage(
                        "修改任务已加入队列，完成后可在导演台预览并采用。",
                      );
                    }}
                  />

                  <div className="divide-y divide-slate-800">
                    {shots.map((shot, index) => {
                      const latestJob = jobsByShot.get(shot.id)?.[0];
                      const frameJobs =
                        scriptQuery.data?.shotFrameCandidates.jobs.filter(
                          (job) => job.scriptShotId === shot.id,
                        ) ?? [];
                      const frameJobIds = new Set(
                        frameJobs.map((job) => job.id),
                      );
                      const frameAssets =
                        scriptQuery.data?.shotFrameCandidates.assets.filter(
                          (asset) =>
                            asset.jobId && frameJobIds.has(asset.jobId),
                        ) ?? [];
                      const activeFrameJob = frameJobs.find((job) =>
                        ["queued", "running"].includes(job.status),
                      );
                      const failedFrameJob = frameJobs.find(
                        (job) => job.status === "failed",
                      );
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
                                updateShot(shot.id, {
                                  title: event.target.value,
                                })
                              }
                              className="min-w-44 flex-1 bg-transparent font-medium outline-none"
                              aria-label={`镜头 ${index + 1} 标题`}
                            />
                            <label className="flex items-center gap-2 text-xs text-slate-500">
                              时长
                              <input
                                type="number"
                                min={5}
                                max={Math.min(
                                  MEDIA_H3_SCRIPT_SHOT_SECONDS,
                                  60 - (totalDuration - shot.durationSeconds),
                                )}
                                step={1}
                                value={shot.durationSeconds}
                                onChange={(event) =>
                                  updateShot(shot.id, {
                                    durationSeconds: Math.min(
                                      Number(event.target.value),
                                      MEDIA_H3_SCRIPT_SHOT_SECONDS,
                                      60 -
                                        (totalDuration - shot.durationSeconds),
                                    ),
                                  })
                                }
                                className="w-16 border border-slate-800 bg-slate-900 px-2 py-1 text-right font-mono text-xs text-slate-300 outline-none focus:border-amber-300"
                                aria-label={`镜头 ${index + 1} 时长`}
                              />
                              秒
                            </label>
                            {latestJob && (
                              <span
                                className={`border px-2 py-1 text-[10px] ${latestJob.status === "succeeded" ? "border-emerald-400/30 text-emerald-300" : latestJob.status === "failed" ? "border-rose-400/30 text-rose-300" : "border-cyan-400/30 text-cyan-300"}`}
                              >
                                {latestJob.kind === "edit" ? "修改" : "生成"} ·{" "}
                                {latestJob.status}
                              </span>
                            )}
                            {(shot.selectedGenerationJobId ??
                              latestJob?.status === "succeeded") &&
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

                          <section className="mt-5 border-y border-slate-800 bg-slate-900/30 py-4">
                            <div className="flex flex-wrap items-center justify-between gap-3 px-1">
                              <div>
                                <p className="text-xs font-medium text-slate-300">
                                  首帧候选
                                </p>
                                <p className="mt-1 text-[11px] text-slate-600">
                                  HiDream 按当前镜头与连续性设定生成 4
                                  个开场构图
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  void createFrameCandidates(shot.id)
                                }
                                disabled={
                                  copyStatus !== "approved" ||
                                  Boolean(activeFrameJob) ||
                                  generating
                                }
                                className="border border-cyan-300/30 px-3 py-2 text-xs text-cyan-200 hover:bg-cyan-300/10 disabled:opacity-30"
                              >
                                {activeFrameJob
                                  ? `生成中 · ${activeFrameJob.status}`
                                  : frameAssets.length > 0
                                    ? "再生成 4 张"
                                    : "生成 4 张首帧"}
                              </button>
                            </div>
                            {copyStatus !== "approved" && (
                              <p className="mt-3 px-1 text-xs text-amber-200/70">
                                先确认上方文案，才能生成首帧候选。
                              </p>
                            )}
                            {failedFrameJob?.errorMessage &&
                              !activeFrameJob && (
                                <p className="mt-3 px-1 text-xs text-rose-300">
                                  上次生成失败：{failedFrameJob.errorMessage}
                                </p>
                              )}
                            {frameAssets.length > 0 && (
                              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                                {frameAssets.map((asset) => {
                                  const selected =
                                    shot.firstFrameAssetId === asset.id;
                                  return (
                                    <button
                                      key={asset.id}
                                      type="button"
                                      onClick={() =>
                                        void selectFrameCandidate(
                                          shot.id,
                                          asset.id,
                                        )
                                      }
                                      className={`group relative aspect-video overflow-hidden border text-left ${selected ? "border-amber-300 ring-1 ring-amber-300" : "border-slate-700 hover:border-cyan-300"}`}
                                      aria-label={`选择 ${shot.title} 的首帧 ${asset.filename}`}
                                    >
                                      <img
                                        src={asset.url}
                                        alt={asset.filename}
                                        className="size-full object-cover transition duration-200 group-hover:scale-[1.02]"
                                      />
                                      <span
                                        className={`absolute right-1 bottom-1 px-2 py-1 text-[10px] ${selected ? "bg-amber-300 text-slate-950" : "bg-slate-950/80 text-slate-300"}`}
                                      >
                                        {selected ? "已选首帧" : "选用"}
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </section>

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
                                    max={Math.max(
                                      0,
                                      shot.durationSeconds - 0.1,
                                    )}
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
                          {
                            ...emptyShot(current.length + 1),
                            durationSeconds: Math.min(
                              MEDIA_H3_SCRIPT_SHOT_SECONDS,
                              60 -
                                current.reduce(
                                  (sum, item) => sum + item.durationSeconds,
                                  0,
                                ),
                            ),
                          },
                        ]);
                        markDirty();
                      }}
                      disabled={shots.length >= 12 || totalDuration > 55}
                      className="w-full px-6 py-5 text-left text-sm text-slate-500 hover:bg-slate-900 hover:text-amber-200 disabled:opacity-30"
                    >
                      + 添加镜头
                    </button>
                  </div>
                </fieldset>
              </form>
            )}
          </section>

          <aside className="space-y-5 xl:sticky xl:top-5 xl:self-start">
            <fieldset
              disabled={generating}
              className="border border-slate-800 bg-slate-900/90 p-5"
            >
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
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <button
                      type="button"
                      disabled={
                        !selectedScriptId ||
                        generating ||
                        deleteMutation.isPending
                      }
                      className="mt-2 px-4 py-2 text-xs text-rose-300 disabled:opacity-30"
                    >
                      删除脚本
                    </button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogTitle className="text-lg font-semibold">
                      删除这个脚本项目？
                    </AlertDialogTitle>
                    <AlertDialogDescription className="mt-2 text-sm text-slate-400">
                      脚本和分镜预演会删除，已生成的视频任务会保留。
                    </AlertDialogDescription>
                    <div className="mt-6 flex justify-end gap-3">
                      <AlertDialogCancel className="border border-slate-600 px-3 py-2 text-sm">
                        取消
                      </AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => void deleteScript()}
                        className="bg-rose-400 px-3 py-2 text-sm text-slate-950"
                      >
                        删除脚本
                      </AlertDialogAction>
                    </div>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </fieldset>

            <fieldset
              disabled={generating}
              className="border-t border-slate-800 pt-4"
            >
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
            </fieldset>
          </aside>
        </div>
      </div>
    </main>
  );
}
