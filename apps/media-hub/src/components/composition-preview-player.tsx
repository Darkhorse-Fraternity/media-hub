import { useEffect, useRef, useState } from "react";

import type { MediaVideoScriptShot } from "@acme/validators";
import { selectMediaVideoScriptTake } from "@acme/validators";

import {
  clampTime,
  compositionClips,
  compositionPosition,
  previewCaptions,
} from "~/lib/shot-timeline";

export function CompositionPreviewPlayer({
  shots,
  jobsByShot,
  currentTime,
  seekRequest,
  onTimeChange,
}: {
  shots: MediaVideoScriptShot[];
  jobsByShot: Map<
    string,
    {
      id: string;
      scriptShotId: string | null;
      status: string;
      kind: string;
      createdAt: Date;
      videoUrl: string | null;
      outputStorageKey: string | null;
    }[]
  >;
  currentTime: number;
  seekRequest: { time: number; serial: number };
  onTimeChange: (time: number) => void;
}) {
  const clips = compositionClips(shots);
  const position = compositionPosition(clips, currentTime);
  const clip = position?.clip;
  const source = clip
    ? selectMediaVideoScriptTake(clip.shot, jobsByShot.get(clip.shot.id) ?? [])
    : null;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const timeRef = useRef(currentTime);
  useEffect(() => {
    timeRef.current = currentTime;
  }, [currentTime]);
  const total = clips.at(-1)?.end ?? 0;
  const sourceKey = `${clip?.shot.id ?? ""}:${source?.id ?? ""}`;
  const sourceStart = clip?.source.start ?? 0;
  const sourceEnd = clip?.source.end ?? 0;
  const clipStart = clip?.start ?? 0;
  const clipEnd = clip?.end ?? 0;
  const advance = (video: HTMLVideoElement) => {
    if (!sourceEnd) return;
    if (video.currentTime >= sourceEnd - 0.025) {
      if (video.currentTime > sourceEnd) video.currentTime = sourceEnd;
      onTimeChange(clipEnd);
      if (clipEnd >= total) {
        video.pause();
        setPlaying(false);
      }
    } else {
      const next =
        clipStart + Math.max(sourceStart, video.currentTime) - sourceStart;
      if (Math.abs(next - timeRef.current) >= 0.04) onTimeChange(next);
    }
  };
  useEffect(() => {
    const video = videoRef.current;
    if (video && video.readyState > 0 && sourceEnd) {
      video.currentTime = clampTime(
        sourceStart + timeRef.current - clipStart,
        sourceStart,
        sourceEnd,
      );
    }
  }, [seekRequest.serial, sourceKey, sourceStart, sourceEnd, clipStart]);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (playing)
      void video.play().catch(() => {
        if (videoRef.current === video) setPlaying(false);
      });
    else video.pause();
  }, [playing, sourceKey]);
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      const video = videoRef.current;
      if (video && !video.paused) advance(video);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  });
  const captions = position
    ? previewCaptions(position.clip.shot, position.sourceTime)
    : [];
  const available = Boolean(source?.videoUrl) && sourceKey !== failedSource;
  return (
    <div className="overflow-hidden rounded-xl border border-slate-800 bg-black">
      <div className="relative aspect-video">
        {source?.videoUrl ? (
          <video
            key={sourceKey}
            ref={videoRef}
            src={source.videoUrl}
            playsInline
            preload="auto"
            aria-label="整片剪辑预览"
            className="size-full"
            onLoadedMetadata={(event) => {
              if (!clip) return;
              const video = event.currentTarget;
              video.currentTime =
                clip.source.start + timeRef.current - clip.start;
              if (playing)
                void video.play().catch(() => {
                  if (videoRef.current === video) setPlaying(false);
                });
            }}
            onTimeUpdate={(event) => advance(event.currentTarget)}
            onEnded={() => {
              if (clip) onTimeChange(clip.end);
              if (clip?.end === total) setPlaying(false);
            }}
            onError={() => {
              setFailedSource(sourceKey);
              setPlaying(false);
            }}
          />
        ) : (
          <div className="grid size-full place-items-center px-6 text-center text-sm text-slate-400">
            {clip
              ? `「${clip.shot.title}」尚未选定可播放的视频`
              : "添加镜头后，在这里预览整片"}
          </div>
        )}
        {failedSource === sourceKey && (
          <p
            role="alert"
            className="absolute inset-x-0 top-3 bg-black/80 p-3 text-center text-xs text-rose-300"
          >
            视频加载失败，请检查此片段的版本。
          </p>
        )}
        {available && captions.length > 0 && (
          <div
            aria-label="字幕预览"
            className="pointer-events-none absolute inset-x-0 bottom-5 flex justify-center px-4"
          >
            <div className="rounded bg-black/80 px-3 py-1 text-center text-sm text-white sm:text-base">
              {captions.map((cue) => (
                <p key={cue.id}>{cue.text.trim().replace(/\s+/g, " ")}</p>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="flex items-center gap-4 bg-slate-950 px-4 py-3 text-xs">
        <button
          type="button"
          disabled={!available}
          aria-label={playing && available ? "暂停整片" : "播放整片"}
          onClick={() => {
            if (currentTime >= total) {
              if (videoRef.current && clip && clip === clips[0])
                videoRef.current.currentTime = clip.source.start;
              onTimeChange(0);
            }
            setPlaying(playing && available ? false : true);
          }}
          className="rounded-md bg-slate-800 px-3 py-1.5 text-slate-200 disabled:opacity-40"
        >
          {playing && available ? "暂停" : "播放整片"}
        </button>
        <span className="text-slate-400 tabular-nums">
          {currentTime.toFixed(1)} / {total.toFixed(1)} 秒
        </span>
        <span className="ml-auto hidden text-slate-500 sm:block">整片预览</span>
      </div>
    </div>
  );
}
