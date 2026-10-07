import type { PointerEvent, RefObject } from "react";
import { useRef, useState } from "react";

import type { MediaVideoScriptShot } from "@acme/validators";
import { cn } from "@acme/ui";
import { Button } from "@acme/ui/button";

import {
  captionTimelineLanes,
  clampTime,
  compositionCaptions,
  compositionClips,
  dragTimelineRange,
} from "~/lib/shot-timeline";

type DragMode = "start" | "end" | "move";
interface TimelineItem {
  id: string;
  start: number;
  end: number;
  label: string;
  content: string;
  minimum: number;
  selected?: boolean;
  dragRange?: { start: number; end: number; duration: number };
  onMoveEnd?: (delta: number) => void;
  onCancel?: () => void;
  onChange: (range: { start: number; end: number }) => void;
  onSelect: () => void;
}

function TimelineRange({
  item,
  duration,
  disabled,
  track,
  kind,
  onDragStart,
  onDragEnd,
}: {
  item: TimelineItem;
  duration: number;
  disabled: boolean;
  track: RefObject<HTMLDivElement | null>;
  kind: "video" | "caption" | "edit";
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const dragged = useRef(false);
  const drag = useRef<{
    pointerId: number;
    origin: number;
    width: number;
    start: number;
    end: number;
    mode: DragMode;
    duration: number;
    scale: number;
    delta: number;
    cancel: () => void;
  } | null>(null);
  const begin = (event: PointerEvent<HTMLButtonElement>, mode: DragMode) => {
    if (disabled || event.button !== 0) return;
    const width = track.current?.getBoundingClientRect().width ?? 0;
    if (!width) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragged.current = false;
    drag.current = {
      pointerId: event.pointerId,
      origin: event.clientX,
      width,
      start: item.dragRange?.start ?? item.start,
      end: item.dragRange?.end ?? item.end,
      mode,
      duration: item.dragRange?.duration ?? duration,
      scale: duration,
      delta: 0,
      cancel:
        item.onCancel ??
        (() =>
          item.onChange({
            start: item.dragRange?.start ?? item.start,
            end: item.dragRange?.end ?? item.end,
          })),
    };
    item.onSelect();
    onDragStart();
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (active?.pointerId !== event.pointerId || disabled) return;
    active.delta =
      ((event.clientX - active.origin) / active.width) * active.scale;
    if (Math.abs(event.clientX - active.origin) > 3) dragged.current = true;
    if (active.mode === "move" && item.onMoveEnd) return;
    item.onChange(
      dragTimelineRange(
        active,
        active.delta,
        active.mode,
        active.duration,
        item.minimum,
      ),
    );
  };
  const finish = () => {
    if (drag.current?.mode === "move" && !disabled)
      item.onMoveEnd?.(drag.current.delta);
    drag.current = null;
    onDragEnd();
  };
  const cancel = () => {
    if (
      drag.current &&
      !disabled &&
      !(drag.current.mode === "move" && item.onMoveEnd)
    )
      drag.current.cancel();
    drag.current = null;
    onDragEnd();
  };
  return (
    <div
      className={cn(
        "absolute inset-y-1 flex min-w-0 items-center overflow-visible rounded-md border",
        kind === "video"
          ? "border-slate-600 bg-slate-700/70 text-slate-100"
          : "border-cyan-300/20 bg-cyan-300/10 text-cyan-100",
        item.selected && "z-20 border-cyan-300/80 bg-cyan-300/20",
      )}
      style={{
        left: `${(item.start / duration) * 100}%`,
        width: `${((item.end - item.start) / duration) * 100}%`,
      }}
      onPointerMove={move}
      onPointerUp={finish}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled}
        aria-label={`${item.label}开始边界`}
        onPointerDown={(event) => begin(event, "start")}
        onClick={(event) => {
          if (!dragged.current || event.detail === 0) item.onSelect();
        }}
        className="absolute inset-y-0 left-0 z-10 h-full w-3 touch-none rounded-l-md rounded-r-none p-0 text-current transition-none hover:bg-white/10"
      >
        <span
          aria-hidden="true"
          className="h-4 w-0.5 rounded-full bg-current opacity-70"
        />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled}
        aria-label={item.label}
        aria-pressed={item.selected}
        onPointerDown={(event) => begin(event, "move")}
        onClick={(event) => {
          if (!dragged.current || event.detail === 0) item.onSelect();
        }}
        className="h-full w-full min-w-0 touch-none justify-start overflow-hidden rounded-md px-4 text-xs text-current transition-none hover:bg-white/5"
      >
        <span className="truncate">{item.content}</span>
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled}
        aria-label={`${item.label}结束边界`}
        onPointerDown={(event) => begin(event, "end")}
        onClick={(event) => {
          if (!dragged.current || event.detail === 0) item.onSelect();
        }}
        className="absolute inset-y-0 right-0 z-10 h-full w-3 touch-none rounded-l-none rounded-r-md p-0 text-current transition-none hover:bg-white/10"
      >
        <span
          aria-hidden="true"
          className="h-4 w-0.5 rounded-full bg-current opacity-70"
        />
      </Button>
    </div>
  );
}

function TimelineLane({
  items,
  duration,
  disabled,
  kind,
  onDragStart,
  onDragEnd,
}: {
  items: TimelineItem[];
  duration: number;
  disabled: boolean;
  kind: "video" | "caption" | "edit";
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={track}
      className={cn(
        "relative rounded-lg bg-slate-900/60",
        kind === "video" ? "h-14" : "h-10",
      )}
      aria-label={
        kind === "video"
          ? "视频轨道"
          : kind === "edit"
            ? "修改范围轨道"
            : "字幕轨道"
      }
    >
      {items.map((item) => (
        <TimelineRange
          key={item.id}
          item={item}
          duration={duration}
          disabled={disabled}
          track={track}
          kind={kind}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        />
      ))}
      {items.length === 0 && (
        <span className="absolute inset-0 flex items-center px-3 text-xs text-slate-600">
          添加字幕后在这里调整
        </span>
      )}
    </div>
  );
}

export function CompositionTimeline({
  shots,
  busy,
  currentTime,
  selectedShotId,
  selectedCaption,
  onSeek,
  onSelectShot,
  onSelectCaption,
  onChange,
  onReorder,
  modification,
}: {
  shots: MediaVideoScriptShot[];
  busy: boolean;
  currentTime: number;
  selectedShotId: string | null;
  selectedCaption: { shotId: string; cueId: string } | null;
  onSeek: (time: number) => void;
  onSelectShot: (id: string) => void;
  onSelectCaption: (shotId: string, cueId: string) => void;
  onChange: (id: string, patch: Partial<MediaVideoScriptShot>) => void;
  onReorder?: (from: number, to: number) => void;
  modification?: {
    start: number;
    end: number;
    min: number;
    max: number;
    onChange: (range: { start: number; end: number }) => void;
  };
}) {
  const clips = compositionClips(shots);
  const captions = compositionCaptions(clips);
  const total = clips.at(-1)?.end ?? 0;
  const [held, setHeld] = useState<{
    duration: number;
    lanes: string[][];
  } | null>(null);
  const duration = held?.duration ?? Math.max(1, total);
  const lanes = held?.lanes ?? captionTimelineLanes(captions);
  const begin = () => setHeld({ duration, lanes });
  const finish = () => setHeld(null);
  const modificationStart = modification
    ? clampTime(modification.start, modification.min, modification.max - 2)
    : 0;
  const modificationEnd = modification
    ? clampTime(modification.end, modificationStart + 2, modification.max)
    : 0;
  return (
    <div
      aria-label="整片时间轴"
      className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 sm:p-5"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-medium text-slate-200">整片时间轴</span>
        <span className="text-slate-400 tabular-nums">
          {currentTime.toFixed(1)} / {total.toFixed(1)} 秒
        </span>
      </div>
      <div className="flex gap-3">
        <div className="w-8 shrink-0 pt-8 text-xs text-slate-500 sm:w-12">
          <div className="flex h-14 items-center">视频</div>
          <div className="mt-2 flex h-10 items-center">字幕</div>
          {modification && (
            <div className="mt-2 flex h-10 items-center text-cyan-300">
              修改
            </div>
          )}
        </div>
        <div className="relative min-w-0 flex-1">
          <div className="relative mb-2 h-6">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 flex justify-between text-xs text-slate-500 tabular-nums"
            >
              {Array.from({ length: 5 }, (_, index) => (
                <span key={index}>{((duration * index) / 4).toFixed(1)}s</span>
              ))}
            </div>
            <input
              type="range"
              aria-label="时间轴播放位置"
              min={0}
              max={total}
              step={0.1}
              value={clampTime(currentTime, 0, total)}
              disabled={!shots.length}
              onChange={(event) => onSeek(Number(event.target.value))}
              className="absolute inset-0 m-0 h-full w-full cursor-col-resize appearance-none bg-transparent focus-visible:ring-1 focus-visible:ring-cyan-300 [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-transparent [&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:w-1 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:bg-transparent"
            />
          </div>
          <TimelineLane
            duration={duration}
            disabled={busy || Boolean(modification)}
            kind="video"
            onDragStart={begin}
            onDragEnd={finish}
            items={clips.map((clip, index) => ({
              id: clip.shot.id,
              start: clip.start,
              end: clip.end,
              label: `镜头 ${index + 1}：${clip.shot.title}`,
              content: `${String(index + 1).padStart(2, "0")} · ${clip.shot.title}`,
              minimum: 1,
              selected: clip.shot.id === selectedShotId,
              dragRange: {
                ...clip.source,
                duration: clip.shot.durationSeconds,
              },
              onSelect: () => onSelectShot(clip.shot.id),
              onChange: (range) =>
                onChange(clip.shot.id, {
                  trimStartSeconds: range.start,
                  trimEndSeconds: range.end,
                }),
              onMoveEnd: (delta) => {
                if (Math.abs(delta) < 0.2 || !onReorder) return;
                const center = (clip.start + clip.end) / 2 + delta;
                const target = clips.findIndex((item) => center < item.end);
                onReorder(index, target < 0 ? clips.length - 1 : target);
              },
            }))}
          />
          <div className="mt-2 space-y-1">
            {(lanes.length ? lanes : [[]]).map((ids, index) => (
              <TimelineLane
                key={index}
                duration={duration}
                disabled={busy || Boolean(modification)}
                kind="caption"
                onDragStart={begin}
                onDragEnd={finish}
                items={ids.flatMap((id) => {
                  const cue = captions.find((item) => item.id === id);
                  const clip = clips.find(
                    (item) => item.shot.id === cue?.shotId,
                  );
                  if (!cue || !clip) return [];
                  return [
                    {
                      id,
                      start: cue.startSeconds,
                      end: cue.endSeconds,
                      label: `字幕：${cue.text || "待填写"}`,
                      content: cue.text || "输入字幕",
                      minimum: 0.1,
                      selected:
                        selectedCaption?.shotId === cue.shotId &&
                        selectedCaption.cueId === cue.cueId,
                      dragRange: {
                        start: cue.startSeconds - clip.start,
                        end: cue.endSeconds - clip.start,
                        duration: clip.end - clip.start,
                      },
                      onSelect: () => onSelectCaption(cue.shotId, cue.cueId),
                      onCancel: () =>
                        onChange(clip.shot.id, {
                          captions: clip.shot.captions,
                        }),
                      onChange: (range: { start: number; end: number }) =>
                        onChange(cue.shotId, {
                          captions: (clip.shot.captions ?? []).map((item) =>
                            item.id === cue.cueId
                              ? {
                                  ...item,
                                  startSeconds: range.start + clip.source.start,
                                  endSeconds: range.end + clip.source.start,
                                }
                              : item,
                          ),
                        }),
                    },
                  ];
                })}
              />
            ))}
          </div>
          {modification && (
            <div className="mt-2">
              <TimelineLane
                duration={duration}
                disabled={busy}
                kind="edit"
                onDragStart={begin}
                onDragEnd={finish}
                items={[
                  {
                    id: "modification",
                    start: modificationStart,
                    end: modificationEnd,
                    label: "画面修改范围",
                    content: "仅修改这段画面 · 保留原音轨",
                    minimum: 2,
                    selected: true,
                    dragRange: {
                      start: modificationStart - modification.min,
                      end: modificationEnd - modification.min,
                      duration: modification.max - modification.min,
                    },
                    onSelect: () =>
                      onSeek(
                        clampTime(
                          modification.start,
                          modification.min,
                          modification.max - 2,
                        ),
                      ),
                    onChange: (range) =>
                      modification.onChange({
                        start: range.start + modification.min,
                        end: range.end + modification.min,
                      }),
                    onCancel: () =>
                      modification.onChange({
                        start: modification.start,
                        end: modification.end,
                      }),
                  },
                ]}
              />
            </div>
          )}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 z-30 w-px bg-cyan-300/70"
            style={{
              left: `${(clampTime(currentTime, 0, total) / duration) * 100}%`,
            }}
          >
            <span className="absolute -top-1 left-1/2 size-2 -translate-x-1/2 rounded-sm bg-cyan-300" />
          </div>
        </div>
      </div>
      <p className="mt-4 text-xs leading-5 text-slate-500">
        {modification
          ? "拖动修改范围或两端边界 · 至少选择 2 秒 · 未选画面与原音轨保留"
          : "点击片段配置 · 拖动片段排序 · 拖动边界裁切 · 字幕使用整片时间"}
      </p>
    </div>
  );
}
