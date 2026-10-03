import { useState } from "react";

import type { MediaVideoScriptShot } from "@acme/validators";

export function ShotEditControls({
  shot,
  busy,
  onSave,
  onChange,
  onGenerateCaptions,
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
    <fieldset disabled={busy} className="mt-5 border-t border-slate-700 pt-5">
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
      {error && (
        <p role="alert" className="mt-2 text-xs text-rose-300">
          {error}
        </p>
      )}
    </fieldset>
  );
}
