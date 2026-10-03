import { useState } from "react";

import type { MediaVideoScriptShot } from "@acme/validators";

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
}

interface DirectorCut {
  status: string;
  videoUrl: string | null;
  sourceJobIds: string[];
  errorMessage: string | null;
}

export function DirectorStage({
  shots,
  jobsByShot,
  assembledJob,
  language,
  busy,
  canAssemble,
  onSelectTake,
  onGenerateShot,
  onAssemble,
  onEditCreated,
}: {
  shots: MediaVideoScriptShot[];
  jobsByShot: Map<string, DirectorTake[]>;
  assembledJob: DirectorCut | null;
  language: "zh" | "en";
  busy: boolean;
  canAssemble: boolean;
  onSelectTake: (shotId: string, jobId: string) => Promise<void>;
  onGenerateShot: (shotId: string) => Promise<void>;
  onAssemble: () => Promise<void>;
  onEditCreated: () => Promise<void>;
}) {
  const [focusedShotId, setFocusedShotId] = useState<string | null>(null);
  const [previewJobId, setPreviewJobId] = useState<string | null>(null);
  const [editingJobId, setEditingJobId] = useState<string | null>(null);
  const [showFinal, setShowFinal] = useState(false);
  const shot = shots.find((item) => item.id === focusedShotId) ?? shots[0];
  const takes = shot ? (jobsByShot.get(shot.id) ?? []) : [];
  const latest = takes[0];
  const selected = shot?.selectedGenerationJobId
    ? takes.find((item) => item.id === shot.selectedGenerationJobId)
    : latest?.status === "succeeded"
      ? latest
      : null;
  const preview = takes.find((item) => item.id === previewJobId) ?? selected;
  const editingTake = takes.find((item) => item.id === editingJobId);
  const totalDuration = shots.reduce(
    (sum, item) => sum + item.durationSeconds,
    0,
  );
  const currentSourceIds = shots.map((item) => {
    const jobs = jobsByShot.get(item.id) ?? [];
    return item.selectedGenerationJobId ?? jobs[0]?.id ?? "";
  });
  const cutIsCurrent =
    Boolean(assembledJob) &&
    assembledJob?.sourceJobIds.length === currentSourceIds.length &&
    assembledJob.sourceJobIds.every(
      (id, index) => id === currentSourceIds[index],
    );

  return (
    <section
      className="border-b border-slate-800 bg-[#101820] p-5 sm:p-6"
      aria-label="短视频导演台"
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-100">导演台</h2>
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

      <div
        className="mt-5 flex gap-2 overflow-x-auto pb-2"
        role="tablist"
        aria-label="镜头"
      >
        {shots.map((item, index) => {
          const shotJobs = jobsByShot.get(item.id) ?? [];
          const selectedJob =
            shotJobs.find((job) => job.id === item.selectedGenerationJobId) ??
            (shotJobs[0]?.status === "succeeded" ? shotJobs[0] : null);
          const focused = item.id === shot?.id && !showFinal;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={focused}
              onClick={() => {
                setFocusedShotId(item.id);
                setPreviewJobId(null);
                setEditingJobId(null);
                setShowFinal(false);
              }}
              className={`min-w-36 flex-1 border px-3 py-3 text-left text-xs outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 ${focused ? "border-cyan-300 bg-cyan-300/10 text-white" : "border-slate-700 bg-slate-950/60 text-slate-400 hover:border-slate-500"}`}
            >
              <span className="block font-medium">
                {index + 1}. {item.title}
              </span>
              <span className="mt-1 block text-[11px] opacity-70">
                {item.durationSeconds}s ·{" "}
                {selectedJob ? "已选片" : shotJobs.length ? "待选片" : "待生成"}
              </span>
            </button>
          );
        })}
        {assembledJob && (
          <button
            type="button"
            role="tab"
            aria-selected={showFinal}
            onClick={() => {
              setShowFinal(true);
              setEditingJobId(null);
            }}
            className={`min-w-36 border px-3 py-3 text-left text-xs outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 ${showFinal ? "border-emerald-300 bg-emerald-300/10 text-white" : "border-slate-700 bg-slate-950/60 text-slate-400"}`}
          >
            <span className="block font-medium">完整成片</span>
            <span className="mt-1 block opacity-70">
              {cutIsCurrent ? "当前版本" : "旧版成片"}
            </span>
          </button>
        )}
      </div>

      {showFinal && assembledJob ? (
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(240px,0.6fr)]">
          <div className="aspect-video overflow-hidden border border-slate-700 bg-black">
            {assembledJob.videoUrl ? (
              <video
                key={assembledJob.videoUrl}
                src={assembledJob.videoUrl}
                controls
                playsInline
                preload="metadata"
                className="h-full w-full"
              />
            ) : (
              <div className="grid h-full place-items-center text-sm text-slate-500">
                成片
                {assembledJob.status === "running" ? "合成中" : "暂不可预览"}
              </div>
            )}
          </div>
          <div className="flex flex-col justify-between border border-slate-700 bg-slate-950/70 p-4 text-sm">
            <div>
              <h3 className="font-semibold">完整成片</h3>
              <p className="mt-2 text-xs leading-5 text-slate-400">
                {cutIsCurrent
                  ? "与当前选定镜头一致。"
                  : "镜头选择已变化，请重新合片。"}
              </p>
              {assembledJob.errorMessage && (
                <p className="mt-3 text-xs text-rose-300">
                  {assembledJob.errorMessage}
                </p>
              )}
            </div>
            {assembledJob.videoUrl && (
              <a
                href={`${assembledJob.videoUrl}?download=1`}
                className="mt-5 text-xs text-cyan-300"
              >
                下载 MP4
              </a>
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
                  className={`border p-2 text-xs ${selected?.id === take.id ? "border-emerald-400/60 bg-emerald-400/5" : "border-slate-700"}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span>
                      {take.kind === "edit" ? "局部修改" : "原始生成"}{" "}
                      {takes.length - index}
                    </span>
                    <span className="text-slate-500">{take.status}</span>
                  </div>
                  {take.errorMessage && (
                    <p className="mt-1 text-rose-300">{take.errorMessage}</p>
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
                        修改此版
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

      {editingTake?.videoUrl && !showFinal && (
        <div className="mt-5 border-t border-slate-700 pt-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">修改当前版本</h3>
            <button
              type="button"
              onClick={() => setEditingJobId(null)}
              className="text-xs text-slate-400"
            >
              收起
            </button>
          </div>
          <VideoEditWorkspace
            key={editingTake.id}
            sourceJobId={editingTake.id}
            sourceTitle={editingTake.title ?? shot?.title ?? "镜头"}
            durationSeconds={editingTake.durationSeconds}
            initialLanguage={language}
            onCreated={() => {
              setEditingJobId(null);
              void onEditCreated();
            }}
          />
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-700 pt-4">
        <p className="text-xs text-slate-500">
          镜头顺序在下方调整。合片采用每镜已选版本。
        </p>
        <button
          type="button"
          disabled={!canAssemble || busy}
          onClick={() => void onAssemble()}
          className="bg-emerald-300 px-4 py-2.5 text-sm font-semibold text-slate-950 disabled:opacity-30"
        >
          合成完整成片
        </button>
      </div>
    </section>
  );
}
