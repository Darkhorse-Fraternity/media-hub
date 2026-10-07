import { useEffect, useRef, useState } from "react";

import type { MediaVideoScriptShot } from "@acme/validators";
import { Button } from "@acme/ui/button";

import { clampTime } from "~/lib/shot-timeline";

export function ShotEditControls({
  shot,
  busy,
  onSave,
  onChange,
  onGenerateCaptions,
  currentTime,
  onSeek,
  compositionOffset,
  activeCaptionId,
  onSelectCaption,
}: {
  shot: MediaVideoScriptShot;
  busy: boolean;
  onChange: (shotId: string, patch: Partial<MediaVideoScriptShot>) => void;
  onSave: (
    shotId: string,
    trimStartSeconds: number,
    trimEndSeconds: number,
    captions: NonNullable<MediaVideoScriptShot["captions"]>,
  ) => Promise<void>;
  onGenerateCaptions: (shotId: string) => Promise<void>;
  currentTime: number;
  onSeek: (time: number) => void;
  compositionOffset: number;
  activeCaptionId?: string | null;
  onSelectCaption?: (id: string) => void;
}) {
  const trimStart = shot.trimStartSeconds ?? 0;
  const trimEnd = shot.trimEndSeconds ?? shot.durationSeconds;
  const captions = shot.captions ?? [];
  const setTrimStart = (value: number) =>
    onChange(shot.id, { trimStartSeconds: value });
  const setTrimEnd = (value: number) =>
    onChange(shot.id, { trimEndSeconds: value });
  const setCaptions = (change: (items: typeof captions) => typeof captions) =>
    onChange(shot.id, { captions: change(captions) });
  const [error, setError] = useState<string | null>(null);
  const [selectedCaptionId, setSelectedCaptionId] = useState<string | null>(
    null,
  );
  const selectedCaption =
    captions.find((cue) => cue.id === (activeCaptionId ?? selectedCaptionId)) ??
    captions[0];
  const timeOffset = compositionOffset - trimStart;
  const captionInput = useRef<HTMLInputElement>(null);
  const focusCaption = useRef(false);
  useEffect(() => {
    if (activeCaptionId) captionInput.current?.focus();
  }, [activeCaptionId]);
  useEffect(() => {
    if (focusCaption.current) {
      captionInput.current?.focus();
      focusCaption.current = false;
    }
  }, [selectedCaption?.id]);
  const selectCaption = (id: string) => {
    focusCaption.current = true;
    setSelectedCaptionId(id);
    onSelectCaption?.(id);
    captionInput.current?.focus();
    const cue = captions.find((item) => item.id === id);
    if (cue) onSeek(Math.max(trimStart, cue.startSeconds) + timeOffset);
  };
  const updateCaption = (
    patch: Partial<NonNullable<typeof selectedCaption>>,
  ) => {
    if (!selectedCaption) return;
    setCaptions((items) =>
      items.map((item) =>
        item.id === selectedCaption.id ? { ...item, ...patch } : item,
      ),
    );
  };

  const save = () => {
    if (
      !Number.isFinite(trimStart) ||
      !Number.isFinite(trimEnd) ||
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
          !Number.isFinite(cue.startSeconds) ||
          !Number.isFinite(cue.endSeconds) ||
          cue.startSeconds < 0 ||
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
    <fieldset
      disabled={busy}
      className="mt-5 min-w-0 overflow-hidden rounded-xl border border-slate-800 bg-slate-950/70"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/70 px-3 py-3 sm:px-5">
        <div>
          <h3 className="text-sm font-semibold text-balance text-slate-100">
            {`片段配置 · ${shot.title}`}
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            裁切入点与出点为素材时间，字幕为整片时间
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy || shot.dialogues.length === 0}
            onClick={() => void onGenerateCaptions(shot.id)}
            className="h-8 rounded-md px-2 text-xs text-slate-400 transition-none hover:bg-slate-800 hover:text-slate-100"
          >
            从台词生成字幕
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={captions.length >= 12}
            onClick={() => {
              const id = crypto.randomUUID();
              focusCaption.current = true;
              setSelectedCaptionId(id);
              onSelectCaption?.(id);
              setCaptions((items) => [
                ...items,
                {
                  id,
                  startSeconds: clampTime(
                    currentTime - timeOffset,
                    trimStart,
                    trimEnd - 0.1,
                  ),
                  endSeconds: Math.min(
                    clampTime(
                      currentTime - timeOffset,
                      trimStart,
                      trimEnd - 0.1,
                    ) + 2,
                    trimEnd,
                  ),
                  text: "",
                },
              ]);
            }}
            className="h-8 rounded-md px-2 text-xs text-slate-300 transition-none hover:bg-slate-800 hover:text-white"
          >
            + 添加字幕
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={save}
            aria-label="保存剪辑与字幕"
            className="h-8 rounded-md bg-cyan-300 px-3 text-xs font-semibold text-slate-950 transition-none hover:bg-cyan-200"
          >
            保存剪辑
          </Button>
        </div>
      </div>
      <div className="space-y-3 border-t border-slate-800/70 bg-slate-900/40 px-3 py-3 sm:px-5">
        <div className="flex flex-wrap items-center gap-3 text-xs tabular-nums">
          <span className="w-10 text-slate-500 sm:w-14">裁切</span>
          <label className="flex items-center gap-2 text-slate-500">
            入点
            <input
              type="number"
              aria-label="从第几秒开始"
              min={0}
              max={shot.durationSeconds - 1}
              step={0.1}
              value={trimStart}
              onChange={(event) => setTrimStart(Number(event.target.value))}
              className="h-8 w-16 rounded-md border border-transparent bg-slate-800/80 px-2 text-xs text-slate-200 outline-none focus:border-cyan-300/60"
            />
          </label>
          <label className="flex items-center gap-2 text-slate-500">
            出点
            <input
              type="number"
              aria-label="到第几秒结束"
              min={1}
              max={shot.durationSeconds}
              step={0.1}
              value={trimEnd}
              onChange={(event) => setTrimEnd(Number(event.target.value))}
              className="h-8 w-16 rounded-md border border-transparent bg-slate-800/80 px-2 text-xs text-slate-200 outline-none focus:border-cyan-300/60"
            />
          </label>
          <span className="ml-auto text-slate-500">
            保留 {Math.max(0, trimEnd - trimStart).toFixed(1)} 秒
          </span>
        </div>
        {selectedCaption && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto sm:flex-1">
              <select
                aria-label="选择字幕"
                value={selectedCaption.id}
                onChange={(event) => selectCaption(event.target.value)}
                className="h-8 w-14 shrink-0 rounded-md border-0 bg-slate-800/80 px-1 text-xs text-slate-300 outline-none focus:ring-1 focus:ring-cyan-300"
              >
                {captions.map((cue, index) => (
                  <option key={cue.id} value={cue.id}>
                    字幕 {index + 1}
                  </option>
                ))}
              </select>
              <input
                ref={captionInput}
                value={selectedCaption.text}
                aria-label="字幕文字"
                onChange={(event) =>
                  updateCaption({ text: event.target.value })
                }
                placeholder="输入这句字幕…"
                className="h-9 min-w-0 flex-1 rounded-md border border-slate-700/60 bg-slate-950/60 px-3 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-cyan-300/60"
              />
            </div>
            <div className="ml-auto flex items-center gap-2 text-xs tabular-nums">
              <input
                type="number"
                min={compositionOffset}
                max={trimEnd + timeOffset}
                step={0.1}
                value={Number(
                  (
                    clampTime(
                      selectedCaption.startSeconds,
                      trimStart,
                      trimEnd,
                    ) + timeOffset
                  ).toFixed(1),
                )}
                aria-label="字幕开始秒数"
                onChange={(event) =>
                  updateCaption({
                    startSeconds: Number(event.target.value) - timeOffset,
                  })
                }
                className="h-8 w-16 rounded-md border border-transparent bg-slate-800/80 px-2 text-xs text-slate-300 outline-none focus:border-cyan-300/60"
              />
              <span className="text-slate-600">—</span>
              <input
                type="number"
                min={compositionOffset}
                max={trimEnd + timeOffset}
                step={0.1}
                value={Number(
                  (
                    clampTime(selectedCaption.endSeconds, trimStart, trimEnd) +
                    timeOffset
                  ).toFixed(1),
                )}
                aria-label="字幕结束秒数"
                onChange={(event) =>
                  updateCaption({
                    endSeconds: Number(event.target.value) - timeOffset,
                  })
                }
                className="h-8 w-16 rounded-md border border-transparent bg-slate-800/80 px-2 text-xs text-slate-300 outline-none focus:border-cyan-300/60"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() =>
                  setCaptions((items) =>
                    items.filter((item) => item.id !== selectedCaption.id),
                  )
                }
                aria-label="删除字幕"
                className="size-8 rounded-md text-slate-500 transition-none hover:bg-slate-800 hover:text-rose-300"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  className="size-4"
                >
                  <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7" />
                </svg>
              </Button>
            </div>
          </div>
        )}
        {error && (
          <p role="alert" className="text-xs text-rose-300">
            {error}
          </p>
        )}
      </div>
    </fieldset>
  );
}
