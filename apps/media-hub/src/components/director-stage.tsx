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
  isCurrent: boolean;
  captioned: boolean;
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
  onSaveShotEdit,
  onGenerateCaptions,
  onCreateAnimatic,
  animaticVideoUrl,
}: {
  shots: MediaVideoScriptShot[];
  jobsByShot: Map<string, DirectorTake[]>;
  assembledJob: DirectorCut | null;
  language: "zh" | "en";
  busy: boolean;
  canAssemble: boolean;
  onSelectTake: (shotId: string, jobId: string) => Promise<void>;
  onGenerateShot: (shotId: string) => Promise<void>;
  onAssemble: (burnCaptions: boolean) => Promise<void>;
  onEditCreated: () => Promise<void>;
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
  const [showFinal, setShowFinal] = useState(false);
  const [showAnimatic, setShowAnimatic] = useState(false);
  const [burnCaptions, setBurnCaptions] = useState(false);
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
    (sum, item) =>
      sum +
      (item.trimEndSeconds ?? item.durationSeconds) -
      (item.trimStartSeconds ?? 0),
    0,
  );
  const cutIsCurrent = assembledJob?.isCurrent ?? false;
  const hasCaptions = shots.some((item) => (item.captions?.length ?? 0) > 0);

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

      <div className="mt-4 flex flex-wrap items-center gap-3 border-y border-slate-700/70 py-3">
        <button
          type="button"
          disabled={busy || shots.length === 0}
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
                setShowAnimatic(false);
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
              <h3 className="font-semibold">
                完整成片{assembledJob.captioned ? " · 带字幕" : ""}
              </h3>
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

      {shot && !showFinal && (
        <ShotEditControls
          key={`${shot.id}:${shot.trimStartSeconds ?? 0}:${shot.trimEndSeconds ?? shot.durationSeconds}:${JSON.stringify(shot.captions ?? [])}`}
          shot={shot}
          busy={busy}
          onSave={onSaveShotEdit}
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
              disabled={!hasCaptions}
              onChange={(event) => setBurnCaptions(event.target.checked)}
              className="accent-emerald-300"
            />
            输出带字幕版
          </label>
          <button
            type="button"
            disabled={!canAssemble || busy}
            onClick={() => void onAssemble(burnCaptions)}
            className="bg-emerald-300 px-4 py-2.5 text-sm font-semibold text-slate-950 disabled:opacity-30"
          >
            合成完整成片
          </button>
        </div>
      </div>
    </section>
  );
}

function ShotEditControls({
  shot,
  busy,
  onSave,
  onGenerateCaptions,
}: {
  shot: MediaVideoScriptShot;
  busy: boolean;
  onSave: (
    shotId: string,
    trimStartSeconds: number,
    trimEndSeconds: number,
    captions: NonNullable<MediaVideoScriptShot["captions"]>,
  ) => Promise<void>;
  onGenerateCaptions: (shotId: string) => Promise<void>;
}) {
  const [trimStart, setTrimStart] = useState(shot.trimStartSeconds ?? 0);
  const [trimEnd, setTrimEnd] = useState(
    shot.trimEndSeconds ?? shot.durationSeconds,
  );
  const [captions, setCaptions] = useState(shot.captions ?? []);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    if (
      trimStart < 0 ||
      trimEnd > shot.durationSeconds ||
      trimEnd - trimStart < 1
    ) {
      setError("裁切后至少保留 1 秒，结束时间不能超过镜头时长。");
      return;
    }
    if (
      captions.some(
        (cue) =>
          !cue.text.trim() ||
          cue.endSeconds <= cue.startSeconds ||
          cue.endSeconds > shot.durationSeconds,
      )
    ) {
      setError("请填写字幕文字，并检查每句字幕的起止时间。");
      return;
    }
    setError(null);
    void onSave(shot.id, trimStart, trimEnd, captions);
  };

  return (
    <div className="mt-5 border-t border-slate-700 pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">剪辑与字幕</h3>
          <p className="mt-1 text-xs text-slate-500">
            裁切只影响合片，不修改原始镜头文件。字幕可在合片时选择是否烧录。
          </p>
        </div>
        <button
          type="button"
          disabled={busy || shot.dialogues.length === 0}
          onClick={() => void onGenerateCaptions(shot.id)}
          className="border border-slate-600 px-3 py-2 text-xs text-slate-300 disabled:opacity-30"
        >
          从台词生成字幕
        </button>
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-3 text-xs">
        <label className="text-slate-400">
          从第几秒开始
          <input
            type="number"
            min={0}
            max={shot.durationSeconds - 1}
            step={0.1}
            value={trimStart}
            onChange={(event) => setTrimStart(Number(event.target.value))}
            className="mt-1 block w-24 border border-slate-700 bg-slate-950 px-2 py-2 text-slate-100"
          />
        </label>
        <label className="text-slate-400">
          到第几秒结束
          <input
            type="number"
            min={1}
            max={shot.durationSeconds}
            step={0.1}
            value={trimEnd}
            onChange={(event) => setTrimEnd(Number(event.target.value))}
            className="mt-1 block w-24 border border-slate-700 bg-slate-950 px-2 py-2 text-slate-100"
          />
        </label>
        <span className="pb-2 text-slate-500">
          保留 {Math.max(0, trimEnd - trimStart).toFixed(1)} 秒
        </span>
      </div>
      <div className="mt-4 space-y-2">
        {captions.map((cue) => (
          <div key={cue.id} className="flex flex-wrap items-center gap-2">
            <input
              type="number"
              min={0}
              max={shot.durationSeconds}
              step={0.1}
              value={cue.startSeconds}
              aria-label="字幕开始秒数"
              onChange={(event) =>
                setCaptions((items) =>
                  items.map((item) =>
                    item.id === cue.id
                      ? { ...item, startSeconds: Number(event.target.value) }
                      : item,
                  ),
                )
              }
              className="w-16 border border-slate-700 bg-slate-950 px-2 py-2 text-xs"
            />
            <span className="text-slate-500">–</span>
            <input
              type="number"
              min={0}
              max={shot.durationSeconds}
              step={0.1}
              value={cue.endSeconds}
              aria-label="字幕结束秒数"
              onChange={(event) =>
                setCaptions((items) =>
                  items.map((item) =>
                    item.id === cue.id
                      ? { ...item, endSeconds: Number(event.target.value) }
                      : item,
                  ),
                )
              }
              className="w-16 border border-slate-700 bg-slate-950 px-2 py-2 text-xs"
            />
            <input
              value={cue.text}
              aria-label="字幕文字"
              onChange={(event) =>
                setCaptions((items) =>
                  items.map((item) =>
                    item.id === cue.id
                      ? { ...item, text: event.target.value }
                      : item,
                  ),
                )
              }
              className="min-w-48 flex-1 border border-slate-700 bg-slate-950 px-2 py-2 text-xs"
            />
            <button
              type="button"
              onClick={() =>
                setCaptions((items) =>
                  items.filter((item) => item.id !== cue.id),
                )
              }
              className="px-2 text-xs text-rose-300"
              aria-label="删除字幕"
            >
              删除
            </button>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={captions.length >= 12}
          onClick={() =>
            setCaptions((items) => [
              ...items,
              {
                id: crypto.randomUUID(),
                startSeconds: 0,
                endSeconds: Math.min(2, shot.durationSeconds),
                text: "",
              },
            ])
          }
          className="text-xs text-cyan-300 disabled:opacity-30"
        >
          + 添加字幕
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={save}
          className="border border-emerald-300/50 px-3 py-2 text-xs text-emerald-200 disabled:opacity-30"
        >
          保存剪辑与字幕
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
    </div>
  );
}
