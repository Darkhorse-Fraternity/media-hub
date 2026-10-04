import { useState } from "react";

import type { MediaVideoScriptShot } from "@acme/validators";
import { cn } from "@acme/ui";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@acme/ui/tabs";
import { selectMediaVideoScriptTake } from "@acme/validators";

import { ShotEditControls } from "~/components/shot-edit-controls";
import { VideoEditWorkspace } from "~/components/video-edit-workspace";

interface DirectorTake {
  id: string;
  scriptShotId: string | null;
  kind: string;
  status: string;
  title: string | null;
  durationSeconds: number;
  createdAt: Date;
  videoUrl: string | null;
  errorMessage: string | null;
  outputStorageKey: string | null;
}

interface DirectorCut {
  id: string;
  title: string | null;
  durationSeconds: number;
  status: string;
  videoUrl: string | null;
  isCurrent: boolean;
  captioned: boolean;
  errorMessage: string | null;
}

export function DirectorStage({
  shots,
  jobsByShot,
  assembledJob,
  cutEditJobs = [],
  language,
  busy,
  canAssemble,
  onSelectTake,
  onGenerateShot,
  onAssemble,
  onEditCreated,
  onSaveShotEdit,
  onChangeShotEdit,
  onGenerateCaptions,
  onCreateAnimatic,
  animaticVideoUrl,
}: {
  shots: MediaVideoScriptShot[];
  jobsByShot: Map<string, DirectorTake[]>;
  assembledJob: DirectorCut | null;
  cutEditJobs?: DirectorTake[];
  language: "zh" | "en";
  busy: boolean;
  canAssemble: boolean;
  onSelectTake: (shotId: string, jobId: string) => Promise<void>;
  onGenerateShot: (shotId: string) => Promise<void>;
  onAssemble: (burnCaptions: boolean) => Promise<void>;
  onEditCreated: () => Promise<void>;
  onChangeShotEdit: (
    shotId: string,
    patch: Partial<MediaVideoScriptShot>,
  ) => void;
  onSaveShotEdit: (
    shotId: string,
    trimStartSeconds: number,
    trimEndSeconds: number,
    captions: NonNullable<MediaVideoScriptShot["captions"]>,
  ) => Promise<void>;
  onGenerateCaptions: (shotId: string) => Promise<void>;
  onCreateAnimatic: () => Promise<void>;
  animaticVideoUrl: string | null;
}) {
  const [focusedShotId, setFocusedShotId] = useState<string | null>(null);
  const [previewJobId, setPreviewJobId] = useState<string | null>(null);
  const [editingJobId, setEditingJobId] = useState<string | null>(null);
  const [previewCutEditId, setPreviewCutEditId] = useState<string | null>(null);
  const [showFinal, setShowFinal] = useState(false);
  const [showAnimatic, setShowAnimatic] = useState(false);
  const [burnCaptions, setBurnCaptions] = useState(false);
  const shot = shots.find((item) => item.id === focusedShotId) ?? shots[0];
  const takes = shot ? (jobsByShot.get(shot.id) ?? []) : [];
  const latest = takes[0];
  const selected = shot ? selectMediaVideoScriptTake(shot, takes) : null;
  const preview = takes.find((item) => item.id === previewJobId) ?? selected;
  const editingTake = takes.find((item) => item.id === editingJobId);
  const previewCutEdit = cutEditJobs.find(
    (item) => item.id === previewCutEditId && item.videoUrl,
  );
  const finalPreview = previewCutEdit ?? assembledJob;
  const editingSource = showFinal
    ? [assembledJob, ...cutEditJobs].find((item) => item?.id === editingJobId)
    : editingTake;
  const totalDuration = shots.reduce(
    (sum, item) =>
      sum +
      (item.trimEndSeconds ?? item.durationSeconds) -
      (item.trimStartSeconds ?? 0),
    0,
  );
  const cutIsCurrent = assembledJob?.isCurrent ?? false;
  const hasCaptions = shots.some((item) => (item.captions?.length ?? 0) > 0);

  return (
    <Tabs
      value={showFinal ? "final" : (shot?.id ?? "")}
      onValueChange={(value) => {
        setShowFinal(value === "final");
        if (value !== "final") setFocusedShotId(value);
        setPreviewJobId(null);
        setEditingJobId(null);
        setShowAnimatic(false);
      }}
    >
      <section
        className="border-b border-slate-800 bg-[#101820] p-5 sm:p-6"
        aria-label="镜头预览与剪辑"
      >
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-slate-100">预览与剪辑</h2>
            <p className="mt-1 text-xs leading-5 text-slate-400">
              预览每一镜，选定采用版本；需要调整画面时直接修改，再合成完整成片。
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span>{shots.length} 镜</span>
            <span aria-hidden="true">/</span>
            <span>{totalDuration} 秒</span>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 border-y border-slate-700/70 py-3">
          <button
            type="button"
            disabled={
              busy ||
              shots.length === 0 ||
              shots.some((item) => !item.firstFrameAssetId)
            }
            onClick={() => void onCreateAnimatic()}
            className="border border-cyan-300/40 px-3 py-2 text-xs text-cyan-200 disabled:opacity-40"
          >
            生成分镜预演
          </button>
          {animaticVideoUrl && (
            <button
              type="button"
              onClick={() => setShowAnimatic((current) => !current)}
              className="text-xs text-cyan-300"
            >
              {showAnimatic ? "收起预演" : "播放预演"}
            </button>
          )}
          <span className="text-xs text-slate-500">
            使用选定首帧检查镜头顺序与时长，不调用 H3。
          </span>
        </div>
        {showAnimatic && animaticVideoUrl && (
          <video
            src={animaticVideoUrl}
            controls
            playsInline
            preload="metadata"
            className="mt-4 aspect-video w-full border border-cyan-300/30 bg-black"
          />
        )}

        <TabsList className="mt-5 overflow-x-auto pb-2" aria-label="镜头">
          {shots.map((item, index) => {
            const shotJobs = jobsByShot.get(item.id) ?? [];
            const selectedJob = selectMediaVideoScriptTake(item, shotJobs);
            const focused = item.id === shot?.id && !showFinal;
            return (
              <TabsTrigger
                value={item.id}
                key={item.id}
                type="button"
                className={cn(
                  "min-w-36 flex-1 border px-3 py-3 text-left text-xs",
                  focused
                    ? "border-cyan-300 bg-cyan-300/10 text-white"
                    : "border-slate-700 bg-slate-950/60 text-slate-400 hover:border-slate-500",
                )}
              >
                <span className="block font-medium">
                  {index + 1}. {item.title}
                </span>
                <span className="mt-1 block text-[11px] opacity-70">
                  {item.durationSeconds}s ·{" "}
                  {selectedJob
                    ? "已选片"
                    : shotJobs.length
                      ? "待选片"
                      : "待生成"}
                </span>
              </TabsTrigger>
            );
          })}
          {assembledJob && (
            <TabsTrigger
              value="final"
              type="button"
              className={cn(
                "min-w-36 border px-3 py-3 text-left text-xs",
                showFinal
                  ? "border-emerald-300 bg-emerald-300/10 text-white"
                  : "border-slate-700 bg-slate-950/60 text-slate-400",
              )}
            >
              <span className="block font-medium">完整成片</span>
              <span className="mt-1 block opacity-70">
                {cutIsCurrent ? "当前版本" : "旧版成片"}
              </span>
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value={showFinal ? "final" : (shot?.id ?? "")}>
          {showFinal && assembledJob ? (
            <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(240px,0.6fr)]">
              <div className="aspect-video overflow-hidden border border-slate-700 bg-black">
                {finalPreview?.videoUrl ? (
                  <video
                    key={finalPreview.id}
                    src={finalPreview.videoUrl}
                    controls
                    playsInline
                    preload="metadata"
                    className="h-full w-full"
                  />
                ) : (
                  <div className="grid h-full place-items-center text-sm text-slate-500">
                    成片
                    {assembledJob.status === "running"
                      ? "合成中"
                      : "暂不可预览"}
                  </div>
                )}
              </div>
              <div className="flex flex-col justify-between border border-slate-700 bg-slate-950/70 p-4 text-sm">
                <div>
                  <h3 className="font-semibold">
                    {previewCutEdit ? "成片修改版" : "完整成片"}
                    {!previewCutEdit && assembledJob.captioned
                      ? " · 带字幕"
                      : ""}
                  </h3>
                  <p className="mt-2 text-xs leading-5 text-slate-400">
                    {previewCutEdit
                      ? "基于成片的局部修改版本，可随时对比原成片。"
                      : cutIsCurrent
                        ? "与当前选定镜头一致。"
                        : "镜头选择已变化，请重新合片。"}
                  </p>
                  {assembledJob.errorMessage && (
                    <p className="mt-3 text-xs text-rose-300">
                      {assembledJob.errorMessage}
                    </p>
                  )}
                </div>
                {finalPreview?.videoUrl && (
                  <div className="mt-5 space-y-3">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setEditingJobId(finalPreview.id)}
                      className="w-full border border-violet-300/50 px-3 py-2 text-xs text-violet-200 disabled:opacity-40"
                    >
                      按片段修改成片
                    </button>
                    <p className="text-xs leading-5 text-slate-400">
                      选择起止秒数并描述画面修改，保留原配音，生成新的修改版本。
                    </p>
                    <a
                      href={`${finalPreview.videoUrl}?download=1`}
                      className="block text-xs text-cyan-300"
                    >
                      下载 MP4
                    </a>
                    {previewCutEdit && (
                      <button
                        type="button"
                        onClick={() => {
                          setPreviewCutEditId(null);
                          setEditingJobId(null);
                        }}
                        className="text-xs text-slate-400"
                      >
                        对比原成片
                      </button>
                    )}
                  </div>
                )}
                {cutEditJobs.length > 0 && (
                  <div className="mt-4 space-y-2 border-t border-slate-700 pt-4">
                    <h4 className="text-xs text-slate-300">成片修改版本</h4>
                    {cutEditJobs.map((item, index) => (
                      <div
                        key={item.id}
                        className="border border-slate-700 p-2 text-xs"
                      >
                        <p>
                          {item.title ??
                            `修改版本 ${cutEditJobs.length - index}`}
                        </p>
                        <p className="mt-1 text-slate-500">{item.status}</p>
                        {item.errorMessage && (
                          <p className="mt-1 text-rose-300">
                            {item.errorMessage}
                          </p>
                        )}
                        {item.videoUrl && (
                          <button
                            type="button"
                            onClick={() => {
                              setPreviewCutEditId(item.id);
                              setEditingJobId(null);
                            }}
                            className="mt-2 text-cyan-300"
                          >
                            预览修改版
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : shot ? (
            <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(260px,0.6fr)]">
              <div className="aspect-video overflow-hidden border border-slate-700 bg-black">
                {preview?.videoUrl ? (
                  <video
                    key={preview.id}
                    src={preview.videoUrl}
                    controls
                    playsInline
                    preload="metadata"
                    className="h-full w-full"
                  />
                ) : (
                  <div className="grid h-full place-items-center p-5 text-center text-sm text-slate-500">
                    {latest
                      ? `镜头${latest.status}，完成后可在这里预览`
                      : "镜头尚未生成"}
                  </div>
                )}
              </div>
              <div className="flex min-h-0 flex-col border border-slate-700 bg-slate-950/70 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold">{shot.title}</h3>
                    <p className="mt-1 text-xs text-slate-500">
                      镜头版本 · {takes.length}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      document
                        .getElementById(`shot-${shot.id}`)
                        ?.scrollIntoView({ behavior: "smooth", block: "start" })
                    }
                    className="text-xs text-cyan-300"
                  >
                    镜头设置
                  </button>
                </div>
                <div className="mt-4 max-h-56 space-y-2 overflow-y-auto pr-1">
                  {takes.length === 0 && (
                    <p className="text-xs leading-5 text-slate-500">
                      生成后可比较版本，并指定合片采用哪一条。
                    </p>
                  )}
                  {takes.map((take, index) => (
                    <div
                      key={take.id}
                      className={cn(
                        "border p-2 text-xs",
                        selected?.id === take.id
                          ? "border-emerald-400/60 bg-emerald-400/5"
                          : "border-slate-700",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span>
                          {take.kind === "edit" ? "局部修改" : "原始生成"}{" "}
                          {takes.length - index}
                        </span>
                        <span className="text-slate-500">{take.status}</span>
                      </div>
                      {take.errorMessage && (
                        <p className="mt-1 text-rose-300">
                          {take.errorMessage}
                        </p>
                      )}
                      {take.videoUrl && (
                        <div className="mt-2 flex flex-wrap gap-3">
                          <button
                            type="button"
                            onClick={() => setPreviewJobId(take.id)}
                            className="text-cyan-300"
                          >
                            预览
                          </button>
                          <button
                            type="button"
                            disabled={
                              busy || shot.selectedGenerationJobId === take.id
                            }
                            onClick={() => void onSelectTake(shot.id, take.id)}
                            className="text-emerald-300 disabled:opacity-40"
                          >
                            {shot.selectedGenerationJobId === take.id
                              ? "已锁定"
                              : selected?.id === take.id
                                ? "锁定此版"
                                : "采用此版"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingJobId(take.id)}
                            className="text-violet-300"
                          >
                            按片段修改此版
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onGenerateShot(shot.id)}
                  className="mt-4 border border-amber-300/50 px-3 py-2 text-xs text-amber-200 disabled:opacity-40"
                >
                  重新生成此镜
                </button>
              </div>
            </div>
          ) : (
            <p className="mt-5 text-sm text-slate-500">
              添加镜头后，可在这里预览和制作。
            </p>
          )}
        </TabsContent>

        {editingSource?.videoUrl && (
          <div className="mt-5 border-t border-slate-700 pt-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">
                {showFinal ? "修改成片片段" : "修改镜头片段"}
              </h3>
              <button
                type="button"
                onClick={() => setEditingJobId(null)}
                className="text-xs text-slate-400"
              >
                收起
              </button>
            </div>
            <VideoEditWorkspace
              key={editingSource.id}
              sourceJobId={editingSource.id}
              sourceTitle={
                editingSource.title ??
                (showFinal ? "完整成片" : shot?.title) ??
                "镜头"
              }
              durationSeconds={editingSource.durationSeconds}
              sourceVideoUrl={editingSource.videoUrl}
              initialLanguage={language}
              onCreated={() => {
                setEditingJobId(null);
                void onEditCreated();
              }}
            />
          </div>
        )}

        {shot && !showFinal && (
          <ShotEditControls
            key={shot.id}
            shot={shot}
            busy={busy}
            onSave={onSaveShotEdit}
            onChange={onChangeShotEdit}
            onGenerateCaptions={onGenerateCaptions}
          />
        )}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-700 pt-4">
          <p className="text-xs text-slate-500">
            镜头顺序在下方调整。合片采用每镜已选版本。
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={burnCaptions}
                disabled={!hasCaptions || busy}
                onChange={(event) => setBurnCaptions(event.target.checked)}
                className="accent-emerald-300"
              />
              输出带字幕版
            </label>
            <button
              type="button"
              disabled={!canAssemble || busy}
              onClick={() => void onAssemble(burnCaptions && hasCaptions)}
              className="bg-emerald-300 px-4 py-2.5 text-sm font-semibold text-slate-950 disabled:opacity-30"
            >
              合成完整成片
            </button>
          </div>
        </div>
      </section>
    </Tabs>
  );
}
