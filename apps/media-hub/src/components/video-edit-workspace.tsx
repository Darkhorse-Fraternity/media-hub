import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import type { ContentLanguage } from "~/lib/content-language";
import type {
  ReferenceImageContentType,
  ReferenceImageDraft,
} from "~/lib/media-generation-form";
import {
  createReferenceImageDraftId,
  referenceImageContentTypes,
  resolveScheduledAt,
  scheduleDayOptions,
  scheduleTimeOptions,
  uploadReferenceImage,
} from "~/lib/media-generation-form";
import { compressReferenceImage } from "~/lib/reference-image-compression";
import { useTRPC } from "~/lib/trpc";
import {
  createVideoEditTitle,
  MAX_VIDEO_EDIT_TITLE_LENGTH,
  validateVideoEditTitle,
} from "~/lib/video-edit-form";

interface VideoEditSegmentDraft {
  id: string;
  startSeconds: number;
  endSeconds: number;
  prompt: string;
  referenceImages: ReferenceImageDraft[];
}

export function VideoEditWorkspace({
  sourceJobId,
  sourceTitle,
  durationSeconds,
  initialLanguage,
  onCreated,
}: {
  sourceJobId: string;
  sourceTitle: string;
  durationSeconds: number;
  initialLanguage: ContentLanguage;
  onCreated: (jobId: string) => void;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(() => createVideoEditTitle(sourceTitle));
  const [language, setLanguage] = useState<ContentLanguage>(initialLanguage);
  const [scheduleDay, setScheduleDay] = useState("now");
  const [scheduleTime, setScheduleTime] = useState("09:00");
  const [segments, setSegments] = useState<VideoEditSegmentDraft[]>([
    {
      id: createReferenceImageDraftId(),
      startSeconds: 0,
      endSeconds: Math.min(5, durationSeconds),
      prompt: "",
      referenceImages: [],
    },
  ]);
  const segmentsRef = useRef(segments);
  const [preparingSegmentId, setPreparingSegmentId] = useState<string | null>(
    null,
  );
  const [optimizingSegmentId, setOptimizingSegmentId] = useState<string | null>(
    null,
  );
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    segmentsRef.current = segments;
  }, [segments]);

  useEffect(
    () => () => {
      segmentsRef.current.forEach((segment) =>
        segment.referenceImages.forEach((image) =>
          URL.revokeObjectURL(image.previewUrl),
        ),
      );
    },
    [],
  );

  const createEditMutation = useMutation(
    trpc.mediaHub.generation.createEdit.mutationOptions({
      onSuccess: (result) => {
        setMessage("修改任务已进入总队列。");
        void queryClient.invalidateQueries({
          queryKey: trpc.mediaHub.generation.list.queryKey(),
        });
        onCreated(result.id);
      },
      onError: (error) => setMessage(error.message),
    }),
  );
  const optimizeMutation = useMutation(
    trpc.mediaHub.ai.optimizePrompt.mutationOptions(),
  );

  const updateSegment = (
    segmentId: string,
    patch: Partial<Omit<VideoEditSegmentDraft, "id">>,
  ) => {
    setSegments((current) =>
      current.map((segment) =>
        segment.id === segmentId ? { ...segment, ...patch } : segment,
      ),
    );
  };

  const addSegment = () => {
    if (segments.length >= 4) {
      setMessage("一次最多修改 4 个时间片段。");
      return;
    }
    const ordered = [...segments].sort(
      (left, right) => left.endSeconds - right.endSeconds,
    );
    const lastEnd = ordered.at(-1)?.endSeconds ?? 0;
    const startSeconds = Math.min(lastEnd, Math.max(0, durationSeconds - 2));
    if (durationSeconds - startSeconds < 2) {
      setMessage("视频末尾没有至少 2 秒的可用区间，请先调整现有片段。");
      return;
    }
    setSegments((current) => [
      ...current,
      {
        id: createReferenceImageDraftId(),
        startSeconds,
        endSeconds: Math.min(durationSeconds, startSeconds + 5),
        prompt: "",
        referenceImages: [],
      },
    ]);
    setMessage(null);
  };

  const removeSegment = (segmentId: string) => {
    setSegments((current) => {
      if (current.length === 1) return current;
      const removed = current.find((segment) => segment.id === segmentId);
      removed?.referenceImages.forEach((image) =>
        URL.revokeObjectURL(image.previewUrl),
      );
      return current.filter((segment) => segment.id !== segmentId);
    });
  };

  const addSegmentImages = async (segmentId: string, files: File[]) => {
    const segment = segmentsRef.current.find((item) => item.id === segmentId);
    if (!segment) return;
    const supported = files.filter((file) =>
      referenceImageContentTypes.has(file.type as ReferenceImageContentType),
    );
    const available = 4 - segment.referenceImages.length;
    const selected = supported.slice(0, available);
    if (!selected.length) {
      setMessage(
        available <= 0
          ? "每个片段最多 4 张参考图。"
          : "仅支持 JPEG、PNG 或 WebP 图片。",
      );
      return;
    }
    setPreparingSegmentId(segmentId);
    setMessage("正在压缩片段参考图…");
    try {
      const prepared = [];
      for (const file of selected) {
        prepared.push(await compressReferenceImage(file));
      }
      updateSegment(segmentId, {
        referenceImages: [
          ...segment.referenceImages,
          ...prepared.map(({ file }) => ({
            id: createReferenceImageDraftId(),
            file,
            previewUrl: URL.createObjectURL(file),
            role: "subject" as const,
          })),
        ],
      });
      setMessage(
        prepared.some((item) => item.compressed)
          ? "较大的参考图已自动压缩。"
          : null,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "参考图压缩失败");
    } finally {
      setPreparingSegmentId(null);
    }
  };

  const removeSegmentImage = (segmentId: string, imageId: string) => {
    const segment = segmentsRef.current.find((item) => item.id === segmentId);
    const image = segment?.referenceImages.find((item) => item.id === imageId);
    if (image) URL.revokeObjectURL(image.previewUrl);
    if (segment) {
      updateSegment(segmentId, {
        referenceImages: segment.referenceImages.filter(
          (item) => item.id !== imageId,
        ),
      });
    }
  };

  const optimizeSegment = async (segment: VideoEditSegmentDraft) => {
    if (!segment.prompt.trim()) return;
    setOptimizingSegmentId(segment.id);
    setMessage("Codex Worker 正在优化该时间片提示词…");
    try {
      const result = await optimizeMutation.mutateAsync({
        prompt: segment.prompt.trim(),
        language,
        title: title.trim() || undefined,
        durationSeconds: Math.max(
          5,
          Math.round(segment.endSeconds - segment.startSeconds),
        ),
        hasReferenceImage: segment.referenceImages.length > 0,
      });
      updateSegment(segment.id, { prompt: result.text });
      setMessage("该时间片提示词已优化。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "提示词优化失败");
    } finally {
      setOptimizingSegmentId(null);
    }
  };

  const submitEdit = async () => {
    const titleError = validateVideoEditTitle(title);
    if (titleError) {
      setMessage(titleError);
      return;
    }
    const ordered = [...segments].sort(
      (left, right) => left.startSeconds - right.startSeconds,
    );
    for (const [index, segment] of ordered.entries()) {
      const clipDuration = segment.endSeconds - segment.startSeconds;
      if (!segment.prompt.trim()) {
        setMessage(`请填写片段 ${index + 1} 的修改描述。`);
        return;
      }
      if (
        segment.startSeconds < 0 ||
        segment.endSeconds > durationSeconds ||
        clipDuration < 2 ||
        clipDuration > 15
      ) {
        setMessage(`片段 ${index + 1} 必须在视频范围内且长度为 2–15 秒。`);
        return;
      }
      const previous = ordered[index - 1];
      if (previous && segment.startSeconds < previous.endSeconds) {
        setMessage(`片段 ${index} 与片段 ${index + 1} 重叠，请调整时间。`);
        return;
      }
    }
    const scheduledAt = resolveScheduledAt(scheduleDay, scheduleTime);
    if (scheduledAt && scheduledAt.getTime() <= Date.now()) {
      setMessage("定点执行时间必须晚于当前时间。");
      return;
    }
    setMessage("正在上传各时间片参考图…");
    try {
      const uploadedSegments = [];
      for (const segment of ordered) {
        const referenceImages = [];
        for (const image of segment.referenceImages) {
          const uploaded = await uploadReferenceImage(image.file);
          referenceImages.push({
            storageKey: uploaded.key,
            name: image.file.name,
            contentType: uploaded.contentType,
            role:
              image.role === "style"
                ? ("style" as const)
                : ("subject" as const),
          });
        }
        uploadedSegments.push({
          id: segment.id,
          startSeconds: segment.startSeconds,
          endSeconds: segment.endSeconds,
          prompt: segment.prompt.trim(),
          preserveSourceAudio: true as const,
          referenceImages,
        });
      }
      await createEditMutation.mutateAsync({
        sourceGenerationJobId: sourceJobId,
        title: title.trim() || undefined,
        language,
        segments: uploadedSegments,
        scheduledAt,
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "创建修改任务失败");
    }
  };

  return (
    <section className="rounded-2xl border border-violet-400/20 bg-slate-950/80 shadow-[0_24px_80px_rgba(76,29,149,0.12)]">
      <header className="border-b border-violet-300/10 px-5 py-5 sm:px-6">
        <p className="text-xs font-semibold tracking-[0.18em] text-violet-300 uppercase">
          Ref2VA edit desk
        </p>
        <h2 className="mt-2 text-xl font-semibold text-violet-50">
          编排修改片段
        </h2>
        <p className="mt-2 max-w-2xl text-xs leading-5 text-slate-400">
          只描述需要变化的时间片；未选片段保持源视频不变，源音轨默认保留。
        </p>
      </header>

      <div className="space-y-5 p-5 sm:p-6">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-slate-400">
            <span className="flex items-center justify-between gap-2">
              <span>新视频名称</span>
              <span className="font-mono text-[10px] text-slate-500">
                {title.length}/{MAX_VIDEO_EDIT_TITLE_LENGTH}
              </span>
            </span>
            <input
              value={title}
              maxLength={MAX_VIDEO_EDIT_TITLE_LENGTH}
              onChange={(event) => setTitle(event.target.value)}
              className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-slate-200 transition outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-400/10"
            />
          </label>
          <label className="text-xs text-slate-400">
            提示词语言
            <select
              value={language}
              onChange={(event) =>
                setLanguage(event.target.value as ContentLanguage)
              }
              className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-slate-200 transition outline-none focus:border-violet-400"
            >
              <option value="en">English</option>
              <option value="zh">中文</option>
            </select>
          </label>
        </div>

        <div>
          <div className="mb-1.5 flex justify-between font-mono text-[10px] text-slate-500">
            <span>0s</span>
            <span>修改时间轴 · {durationSeconds}s</span>
            <span>{durationSeconds}s</span>
          </div>
          <div className="relative h-10 overflow-hidden rounded-lg border border-slate-700 bg-slate-950">
            <span className="absolute inset-x-0 top-1/2 h-px bg-slate-800" />
            {segments.map((segment, index) => (
              <span
                key={segment.id}
                title={`${segment.startSeconds}s–${segment.endSeconds}s`}
                className="absolute inset-y-1 flex min-w-6 items-center justify-center rounded-md bg-violet-300 text-[10px] font-bold text-slate-950 shadow-[0_0_18px_rgba(196,181,253,0.2)]"
                style={{
                  left: `${(segment.startSeconds / durationSeconds) * 100}%`,
                  width: `${((segment.endSeconds - segment.startSeconds) / durationSeconds) * 100}%`,
                }}
              >
                {index + 1}
              </span>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          {segments.map((segment, index) => (
            <article
              key={segment.id}
              className="rounded-xl border border-slate-700 bg-slate-900/60 p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="flex size-6 items-center justify-center rounded-md bg-violet-300 text-[11px] font-bold text-slate-950">
                    {index + 1}
                  </span>
                  <p className="text-xs font-semibold text-violet-100">
                    修改片段
                  </p>
                </div>
                {segments.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeSegment(segment.id)}
                    className="text-[11px] text-rose-300 transition hover:text-rose-200"
                  >
                    删除片段
                  </button>
                )}
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="text-[11px] text-slate-400">
                  开始时间（秒）
                  <input
                    type="number"
                    min="0"
                    max={Math.max(0, durationSeconds - 2)}
                    step="0.5"
                    value={segment.startSeconds}
                    onChange={(event) =>
                      updateSegment(segment.id, {
                        startSeconds: Number(event.target.value),
                      })
                    }
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs outline-none focus:border-violet-400"
                  />
                </label>
                <label className="text-[11px] text-slate-400">
                  结束时间（秒）
                  <input
                    type="number"
                    min="2"
                    max={durationSeconds}
                    step="0.5"
                    value={segment.endSeconds}
                    onChange={(event) =>
                      updateSegment(segment.id, {
                        endSeconds: Number(event.target.value),
                      })
                    }
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs outline-none focus:border-violet-400"
                  />
                </label>
              </div>
              <div className="mt-3">
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor={`edit-segment-prompt-${segment.id}`}
                    className="text-[11px] text-slate-400"
                  >
                    该片段修改描述
                  </label>
                  <button
                    type="button"
                    disabled={
                      !segment.prompt.trim() || optimizingSegmentId !== null
                    }
                    onClick={() => void optimizeSegment(segment)}
                    className="rounded-md border border-violet-400/30 px-2 py-1 text-[10px] text-violet-200 transition hover:bg-violet-400/10 disabled:opacity-40"
                  >
                    {optimizingSegmentId === segment.id
                      ? "AI 优化中…"
                      : "✦ AI 优化"}
                  </button>
                </div>
                <textarea
                  id={`edit-segment-prompt-${segment.id}`}
                  rows={4}
                  value={segment.prompt}
                  placeholder="例如：把桌上的红色杯子改成透明玻璃杯，保持人物动作和镜头不变。"
                  onChange={(event) =>
                    updateSegment(segment.id, { prompt: event.target.value })
                  }
                  className="mt-1.5 w-full resize-y rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs leading-5 transition outline-none focus:border-violet-400"
                />
              </div>
              <div className="mt-3">
                <label className="block cursor-pointer rounded-lg border border-dashed border-slate-700 px-3 py-2.5 text-center text-[11px] text-slate-400 transition hover:border-violet-400/50 hover:text-violet-200">
                  {preparingSegmentId === segment.id
                    ? "正在压缩图片…"
                    : `添加该片段参考图（${segment.referenceImages.length}/4）`}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    disabled={
                      preparingSegmentId !== null ||
                      segment.referenceImages.length >= 4
                    }
                    onChange={(event) => {
                      const files = Array.from(event.target.files ?? []);
                      event.target.value = "";
                      void addSegmentImages(segment.id, files);
                    }}
                    className="sr-only"
                  />
                </label>
                {segment.referenceImages.length > 0 && (
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {segment.referenceImages.map((image) => (
                      <div
                        key={image.id}
                        className="overflow-hidden rounded-lg border border-slate-700 bg-slate-900"
                      >
                        <img
                          src={image.previewUrl}
                          alt={image.file.name}
                          className="aspect-square w-full object-cover"
                        />
                        <div className="space-y-1 p-1.5">
                          <select
                            value={image.role}
                            onChange={(event) =>
                              updateSegment(segment.id, {
                                referenceImages: segment.referenceImages.map(
                                  (item) =>
                                    item.id === image.id
                                      ? {
                                          ...item,
                                          role: event.target.value as
                                            | "style"
                                            | "subject",
                                        }
                                      : item,
                                ),
                              })
                            }
                            className="w-full rounded border border-slate-700 bg-slate-950 px-1 py-1 text-[10px]"
                          >
                            <option value="subject">主体参考</option>
                            <option value="style">风格参考</option>
                          </select>
                          <button
                            type="button"
                            onClick={() =>
                              removeSegmentImage(segment.id, image.id)
                            }
                            className="w-full text-[10px] text-rose-300"
                          >
                            删除
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>

        <button
          type="button"
          disabled={segments.length >= 4}
          onClick={addSegment}
          className="w-full rounded-lg border border-dashed border-violet-300/30 px-3 py-2.5 text-xs text-violet-200 transition hover:bg-violet-300/5 disabled:opacity-40"
        >
          ＋ 添加另一个时间片段
        </button>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-slate-400">
            执行日期
            <select
              value={scheduleDay}
              onChange={(event) => setScheduleDay(event.target.value)}
              className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs"
            >
              {scheduleDayOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-400">
            执行时间
            <select
              value={scheduleTime}
              disabled={scheduleDay === "now"}
              onChange={(event) => setScheduleTime(event.target.value)}
              className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs disabled:opacity-50"
            >
              {scheduleTimeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-slate-200">
                提交后进入总生成队列
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                Ref2VA 与普通生成共享单 GPU 队列，任务会按顺序执行。
              </p>
            </div>
            <button
              type="button"
              disabled={
                createEditMutation.isPending || preparingSegmentId !== null
              }
              onClick={() => void submitEdit()}
              className="rounded-lg bg-violet-300 px-5 py-2.5 text-xs font-semibold text-slate-950 transition hover:bg-violet-200 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {createEditMutation.isPending ? "正在创建…" : "提交修改任务"}
            </button>
          </div>
          {message && (
            <p
              role="status"
              className="mt-3 border-t border-slate-800 pt-3 text-xs text-cyan-300"
            >
              {message}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
