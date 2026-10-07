import type { ReactNode } from "react";
import { useCallback, useState } from "react";

import type { MediaVideoScriptShot } from "@acme/validators";
import { cn } from "@acme/ui";
import { selectMediaVideoScriptTake } from "@acme/validators";

import { CompositionPreviewPlayer } from "~/components/composition-preview-player";
import { ShotEditControls } from "~/components/shot-edit-controls";
import { CompositionTimeline } from "~/components/shot-timeline";
import { VideoEditWorkspace } from "~/components/video-edit-workspace";
import {
  clampTime,
  compositionCaptions,
  compositionClips,
} from "~/lib/shot-timeline";

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

const takeStatusLabels: Record<string, string> = {
  succeeded: "已完成",
  running: "生成中",
  queued: "排队中",
  scheduled: "待开始",
  failed: "失败",
  canceled: "已取消",
};

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
  selectedShotId,
  onSelectShot,
  onReorder,
  shotSettings,
  timelineActions,
}: {
  shots: MediaVideoScriptShot[];
  jobsByShot: Map<string, DirectorTake[]>;
  assembledJob: DirectorCut | null;
  cutEditJobs?: DirectorTake[];
  language: "zh" | "en";
  busy: boolean;
  canAssemble: boolean;
  onSelectTake: (
    shotId: string,
    jobId: string,
    options?: { throwOnError?: boolean },
  ) => Promise<void>;
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
  selectedShotId?: string | null;
  onSelectShot?: (id: string) => void;
  onReorder?: (from: number, to: number) => void;
  shotSettings?: ReactNode;
  timelineActions?: ReactNode;
}) {
  const [focusedShotId, setFocusedShotId] = useState<string | null>(null);
  const [selectedCaption, setSelectedCaption] = useState<{
    shotId: string;
    cueId: string;
  } | null>(null);
  const [editingJobId, setEditingJobId] = useState<string | null>(null);
  const [editingRange, setEditingRange] = useState<{
    start: number;
    end: number;
  } | null>(null);
  const [editingBusy, setEditingBusy] = useState(false);
  const controlsBusy = busy || editingBusy;
  const [previewMode, setPreviewMode] = useState("composition");
  const [burnCaptions, setBurnCaptions] = useState(false);
  const [showTakes, setShowTakes] = useState(false);
  const [time, setTime] = useState(0);
  const [seekRequest, setSeekRequest] = useState({ time: 0, serial: 0 });
  const clips = compositionClips(shots);
  const total = clips.at(-1)?.end ?? 0;
  const currentTime = clampTime(time, 0, total);
  const shot =
    shots.find((item) => item.id === (selectedShotId ?? focusedShotId)) ??
    shots[0];
  const clip = clips.find((item) => item.shot.id === shot?.id);
  const takes = shot ? (jobsByShot.get(shot.id) ?? []) : [];
  const selected = shot ? selectMediaVideoScriptTake(shot, takes) : null;
  const finalPreview = [assembledJob, ...cutEditJobs].find(
    (item) => item?.id === previewMode,
  );
  const editingSource = [assembledJob, ...cutEditJobs, ...takes].find(
    (item) => item?.id === editingJobId,
  );
  const editingTake = takes.find((take) => take.id === editingJobId);
  const timelineEditing = Boolean(
    editingTake && editingTake.id === selected?.id && editingRange && clip,
  );
  const editEnd =
    clip && selected ? Math.min(clip.source.end, selected.durationSeconds) : 0;
  const canEditClip = Boolean(
    selected?.videoUrl && clip && editEnd - clip.source.start >= 2,
  );
  const onTimeChange = useCallback((next: number) => setTime(next), []);
  const seek = (next: number) => {
    const value = clampTime(next, 0, total);
    setPreviewMode("composition");
    setTime(value);
    setSeekRequest((request) => ({ time: value, serial: request.serial + 1 }));
  };
  const focusShot = (id: string) => {
    setFocusedShotId(id);
    onSelectShot?.(id);
    setSelectedCaption(null);
    setEditingJobId(null);
    setEditingRange(null);
    setShowTakes(false);
  };
  const change = (id: string, patch: Partial<MediaVideoScriptShot>) => {
    setPreviewMode("composition");
    onChangeShotEdit(id, patch);
  };
  const reorder = (from: number, to: number) => {
    if (!onReorder || from === to) return;
    const moved = clips[from];
    if (moved) focusShot(moved.shot.id);
    setPreviewMode("composition");
    onReorder(from, to);
    const reordered = [...shots];
    const [item] = reordered.splice(from, 1);
    if (item) reordered.splice(to, 0, item);
    const next = compositionClips(reordered).find(
      (value) => value.shot.id === moved?.shot.id,
    );
    if (next) seek(next.start);
  };
  const hasCaptions = shots.some((item) => (item.captions?.length ?? 0) > 0);
  const openClipEdit = () => {
    if (!selected || !clip || !canEditClip) return;
    setEditingJobId(selected.id);
    setEditingRange({ start: clip.source.start, end: editEnd });
    setShowTakes(false);
    setSelectedCaption(null);
    seek(clip.start);
  };

  return (
    <section
      className="border-b border-slate-800 bg-slate-900/40 p-4 text-slate-300 sm:p-6"
      aria-label="整片预览与剪辑"
    >
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">成片工作台</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            所有镜头在同一条时间轴上组合、裁切和配置。
          </p>
        </div>
        <span className="rounded-full bg-slate-800/60 px-3 py-1.5 text-xs text-slate-400 tabular-nums">
          {shots.length} 镜 · {total.toFixed(1)} 秒
        </span>
      </div>
      <div className="mx-auto max-w-3xl">
        <div className="mb-3 flex flex-wrap items-center gap-3 text-xs">
          <label className="flex items-center gap-2 text-slate-400">
            预览
            <select
              aria-label="预览版本"
              disabled={editingBusy}
              value={previewMode}
              onChange={(event) => {
                setPreviewMode(event.target.value);
                setEditingJobId(null);
              }}
              className="max-w-56 rounded-md bg-slate-800 px-3 py-2 text-slate-200"
            >
              <option value="composition">当前时间轴</option>
              {assembledJob && (
                <option value={assembledJob.id}>
                  完整成片
                  {assembledJob.isCurrent ? " · 当前版本" : " · 需要重新合片"}
                </option>
              )}
              {cutEditJobs
                .filter((item) => item.videoUrl)
                .map((item, index) => (
                  <option key={item.id} value={item.id}>
                    {item.title ?? `成片修改版 ${index + 1}`}
                  </option>
                ))}
              {animaticVideoUrl && <option value="animatic">分镜预演</option>}
            </select>
          </label>
          {finalPreview?.videoUrl && (
            <>
              <a
                href={`${finalPreview.videoUrl}?download=1`}
                className="text-cyan-300"
              >
                下载 MP4
              </a>
              <button
                type="button"
                disabled={controlsBusy}
                onClick={() => setEditingJobId(finalPreview.id)}
                className="text-slate-300 disabled:opacity-40"
              >
                按片段修改成片
              </button>
              {previewMode !== assembledJob?.id && assembledJob && (
                <button
                  type="button"
                  onClick={() => {
                    setPreviewMode(assembledJob.id);
                    setEditingJobId(null);
                  }}
                  className="text-slate-400"
                >
                  对比原成片
                </button>
              )}
            </>
          )}
        </div>
        {finalPreview ? (
          <div className="aspect-video overflow-hidden rounded-xl bg-black">
            {finalPreview.videoUrl ? (
              <video
                key={finalPreview.id}
                src={finalPreview.videoUrl}
                controls
                playsInline
                preload="metadata"
                aria-label="已导出成片预览"
                className="size-full"
              />
            ) : (
              <div className="grid size-full place-items-center text-sm text-slate-500">
                成片
                {finalPreview.status === "running" ? "合成中" : "暂不可预览"}
              </div>
            )}
          </div>
        ) : previewMode === "animatic" && animaticVideoUrl ? (
          <video
            src={animaticVideoUrl}
            controls
            playsInline
            className="aspect-video w-full rounded-xl bg-black"
          />
        ) : (
          <CompositionPreviewPlayer
            shots={shots}
            jobsByShot={jobsByShot}
            currentTime={currentTime}
            seekRequest={seekRequest}
            onTimeChange={onTimeChange}
          />
        )}
        {finalPreview?.errorMessage && (
          <p role="alert" className="mt-2 text-xs text-rose-300">
            {finalPreview.errorMessage}
          </p>
        )}
        {finalPreview && (
          <p className="mt-2 text-xs text-slate-500">
            {assembledJob?.isCurrent && previewMode === assembledJob.id
              ? "此成片与当前时间轴一致。"
              : "正在查看已导出版本；修改下方时间轴后，请重新合片。"}
          </p>
        )}
      </div>
      <div className="mt-5">
        {timelineActions && (
          <fieldset disabled={editingBusy} className="mb-3 flex justify-end">
            {timelineActions}
          </fieldset>
        )}
        <CompositionTimeline
          shots={shots}
          busy={controlsBusy}
          currentTime={currentTime}
          selectedShotId={shot?.id ?? null}
          selectedCaption={selectedCaption}
          onSeek={seek}
          onSelectShot={(id) => {
            focusShot(id);
            const item = clips.find((value) => value.shot.id === id);
            if (item) seek(item.start);
          }}
          onSelectCaption={(shotId, cueId) => {
            if (shotId !== shot?.id) focusShot(shotId);
            setSelectedCaption({ shotId, cueId });
            const cue = compositionCaptions(clips).find(
              (item) => item.shotId === shotId && item.cueId === cueId,
            );
            if (cue) seek(cue.startSeconds);
          }}
          onChange={change}
          onReorder={onReorder ? reorder : undefined}
          modification={
            timelineEditing && editingRange && clip
              ? {
                  start: editingRange.start + clip.start - clip.source.start,
                  end: editingRange.end + clip.start - clip.source.start,
                  min: clip.start,
                  max: clip.start + editEnd - clip.source.start,
                  onChange: (range) =>
                    setEditingRange({
                      start: range.start - clip.start + clip.source.start,
                      end: range.end - clip.start + clip.source.start,
                    }),
                }
              : undefined
          }
        />
      </div>
      {shot && clip && (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
            <span className="mr-auto text-slate-400">
              选中片段 · {clip.start.toFixed(1)}–{clip.end.toFixed(1)} 秒
            </span>
            <button
              type="button"
              disabled={controlsBusy || !canEditClip}
              onClick={() =>
                timelineEditing ? setEditingJobId(null) : openClipEdit()
              }
              aria-expanded={timelineEditing}
              aria-controls="timeline-clip-editor"
              className="rounded-md border border-cyan-300/40 bg-cyan-300/10 px-3 py-2 font-medium text-cyan-200 disabled:opacity-30"
            >
              修改选中片段
            </button>
            <button
              type="button"
              disabled={
                busy ||
                timelineEditing ||
                !onReorder ||
                clips.indexOf(clip) === 0
              }
              onClick={() =>
                reorder(clips.indexOf(clip), clips.indexOf(clip) - 1)
              }
              className="text-slate-400 disabled:opacity-30"
            >
              前移片段
            </button>
            <button
              type="button"
              disabled={
                busy ||
                timelineEditing ||
                !onReorder ||
                clips.indexOf(clip) === clips.length - 1
              }
              onClick={() =>
                reorder(clips.indexOf(clip), clips.indexOf(clip) + 1)
              }
              className="text-slate-400 disabled:opacity-30"
            >
              后移片段
            </button>
            <button
              type="button"
              aria-expanded={showTakes}
              disabled={editingBusy}
              onClick={() => setShowTakes((value) => !value)}
              className="text-cyan-300"
            >
              {showTakes ? "收起片段版本" : `片段版本 (${takes.length})`}
            </button>
          </div>
          {!canEditClip && (
            <p className="mt-2 text-xs text-slate-500">
              {selected?.videoUrl
                ? "局部修改至少需要 2 秒，请延长片段裁切范围。"
                : "片段生成完成并选用后，可在这里修改画面。"}
            </p>
          )}
          {showTakes && (
            <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/60 p-4">
              <div className="flex flex-wrap gap-2">
                {takes.map((take, index) => (
                  <div
                    key={take.id}
                    className={cn(
                      "rounded-md bg-slate-900 p-3 text-xs",
                      selected?.id === take.id && "ring-1 ring-cyan-300/40",
                    )}
                  >
                    <p>
                      {take.kind === "edit" ? "修改" : "生成"}{" "}
                      {takes.length - index} ·{" "}
                      {takeStatusLabels[take.status] ?? take.status}
                    </p>
                    {take.errorMessage && (
                      <p className="mt-2 text-rose-300">{take.errorMessage}</p>
                    )}
                    {take.videoUrl && (
                      <div className="mt-2 flex gap-3">
                        <button
                          type="button"
                          disabled={
                            controlsBusy ||
                            shot.selectedGenerationJobId === take.id
                          }
                          onClick={() => void onSelectTake(shot.id, take.id)}
                          className="text-cyan-300 disabled:opacity-40"
                        >
                          {selected?.id === take.id ? "锁定此版" : "采用此版"}
                        </button>
                        <button
                          type="button"
                          disabled={controlsBusy}
                          onClick={() => setEditingJobId(take.id)}
                          className="text-slate-400"
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
                disabled={controlsBusy}
                onClick={() => void onGenerateShot(shot.id)}
                className="mt-3 text-xs text-cyan-300 disabled:opacity-40"
              >
                重新生成此镜
              </button>
            </div>
          )}
          {!timelineEditing && (
            <ShotEditControls
              key={shot.id}
              shot={shot}
              busy={busy}
              onSave={onSaveShotEdit}
              onChange={change}
              onGenerateCaptions={onGenerateCaptions}
              currentTime={currentTime}
              onSeek={seek}
              compositionOffset={clip.start}
              activeCaptionId={
                selectedCaption?.shotId === shot.id
                  ? selectedCaption.cueId
                  : null
              }
              onSelectCaption={(cueId) =>
                setSelectedCaption({ shotId: shot.id, cueId })
              }
            />
          )}
          {shotSettings && !timelineEditing && (
            <details
              key={shot.id}
              className="mt-3 rounded-xl border border-slate-800 bg-slate-950/50"
            >
              <summary className="cursor-pointer px-4 py-3 text-xs font-medium text-slate-300">
                画面、首帧与声音配置
              </summary>
              {shotSettings}
            </details>
          )}
        </>
      )}
      {editingSource?.videoUrl && (
        <div
          id="timeline-clip-editor"
          className="mt-5 border-t border-slate-800 pt-4"
        >
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-medium">
              {timelineEditing ? `修改选中片段 · ${shot?.title}` : "修改片段"}
            </h3>
            <button
              type="button"
              onClick={() => setEditingJobId(null)}
              disabled={controlsBusy}
              className="text-xs text-slate-400"
            >
              收起
            </button>
          </div>
          <VideoEditWorkspace
            key={editingSource.id}
            sourceJobId={editingSource.id}
            sourceTitle={editingSource.title ?? "完整成片"}
            durationSeconds={editingSource.durationSeconds}
            sourceVideoUrl={editingSource.videoUrl}
            initialLanguage={language}
            busy={busy}
            onPendingChange={setEditingBusy}
            onBeforeCreate={
              timelineEditing &&
              shot &&
              editingTake &&
              shot.selectedGenerationJobId !== editingTake.id
                ? async () =>
                    onSelectTake(shot.id, editingTake.id, {
                      throwOnError: true,
                    })
                : undefined
            }
            timelineSelection={
              timelineEditing && editingRange && clip
                ? {
                    startSeconds: editingRange.start,
                    endSeconds: editingRange.end,
                    minSeconds: clip.source.start,
                    maxSeconds: editEnd,
                    timeOffset: clip.start - clip.source.start,
                    currentTime,
                    onChange: setEditingRange,
                    onSeek: seek,
                  }
                : undefined
            }
            onCreated={() => {
              setEditingJobId(null);
              setShowTakes(true);
              void onEditCreated();
            }}
          />
        </div>
      )}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-4">
        <button
          type="button"
          disabled={
            controlsBusy ||
            shots.length === 0 ||
            shots.some((item) => !item.firstFrameAssetId)
          }
          onClick={() => void onCreateAnimatic()}
          className="text-xs text-slate-400 disabled:opacity-30"
        >
          生成分镜预演
        </button>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={burnCaptions}
              disabled={!hasCaptions || controlsBusy}
              onChange={(event) => setBurnCaptions(event.target.checked)}
              className="accent-cyan-300"
            />
            输出带字幕版
          </label>
          <button
            type="button"
            disabled={!canAssemble || controlsBusy}
            onClick={() => void onAssemble(burnCaptions && hasCaptions)}
            className="rounded-lg bg-cyan-300 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-cyan-200 disabled:opacity-30"
          >
            合成完整成片
          </button>
        </div>
      </div>
    </section>
  );
}
