import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { authClient } from "~/auth/client";
import { formatGenerationElapsed } from "~/lib/generation-display";
import { useTRPC } from "~/lib/trpc";

const activeVideoStatuses = ["scheduled", "queued", "running"] as const;
const activeImageStatuses = new Set(["queued", "running"]);

export function FloatingMediaQueue() {
  const sessionQuery = authClient.useSession();
  const authenticated = Boolean(sessionQuery.data?.user);
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(true);
  const [messages, setMessages] = useState<Record<string, string>>({});

  const videoJobsQuery = useQuery(
    trpc.mediaHub.generation.list.queryOptions(
      { page: 1, pageSize: 100, statuses: [...activeVideoStatuses] },
      { enabled: authenticated, refetchInterval: 5_000 },
    ),
  );
  const imageJobsQuery = useQuery(
    trpc.mediaHub.image.list.queryOptions(
      { limit: 80 },
      { enabled: authenticated, refetchInterval: 3_000 },
    ),
  );
  const videoHealthQuery = useQuery(
    trpc.mediaHub.generation.providerHealth.queryOptions(undefined, {
      enabled: authenticated,
      refetchInterval: 15_000,
      retry: false,
    }),
  );
  const imageHealthQuery = useQuery(
    trpc.mediaHub.image.providerHealth.queryOptions(undefined, {
      enabled: authenticated,
      refetchInterval: 15_000,
      retry: false,
    }),
  );

  const refreshVideos = () =>
    queryClient.invalidateQueries({
      queryKey: trpc.mediaHub.generation.list.queryKey(),
    });
  const refreshImages = () =>
    queryClient.invalidateQueries({
      queryKey: trpc.mediaHub.image.list.queryKey(),
    });
  const cancelVideoMutation = useMutation(
    trpc.mediaHub.generation.cancel.mutationOptions({
      onSuccess: async (_, variables) => {
        setMessages((current) => ({
          ...current,
          [`video:${variables.id}`]: "视频任务已取消。",
        }));
        await refreshVideos();
      },
      onError: (error, variables) =>
        setMessages((current) => ({
          ...current,
          [`video:${variables.id}`]: error.message,
        })),
    }),
  );
  const cancelImageMutation = useMutation(
    trpc.mediaHub.image.cancel.mutationOptions({
      onSuccess: async (_, variables) => {
        setMessages((current) => ({
          ...current,
          [`image:${variables.id}`]: "图片任务已取消。",
        }));
        await refreshImages();
      },
      onError: (error, variables) =>
        setMessages((current) => ({
          ...current,
          [`image:${variables.id}`]: error.message,
        })),
    }),
  );
  const retryImageMutation = useMutation(
    trpc.mediaHub.image.retry.mutationOptions({
      onSuccess: async (_, variables) => {
        setMessages((current) => ({
          ...current,
          [`image:${variables.id}`]: "图片任务已重新加入队列。",
        }));
        await refreshImages();
      },
      onError: (error, variables) =>
        setMessages((current) => ({
          ...current,
          [`image:${variables.id}`]: error.message,
        })),
    }),
  );

  if (!authenticated) return null;

  const videoJobs = videoJobsQuery.data?.rows ?? [];
  const allImageJobs = imageJobsQuery.data?.jobs ?? [];
  const activeImageJobs = allImageJobs.filter((job) =>
    activeImageStatuses.has(job.status),
  );
  const failedImageJobs = allImageJobs
    .filter((job) => job.status === "failed")
    .slice(0, 3);
  const activeCount = videoJobs.length + activeImageJobs.length;
  const visibleCount = activeCount + failedImageJobs.length;

  return (
    <aside className="fixed bottom-4 left-4 z-40 w-[min(26rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-cyan-400/25 bg-slate-950/95 text-slate-100 shadow-[0_24px_80px_rgba(2,8,23,0.65)] backdrop-blur-xl">
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls="floating-media-queue"
        onClick={() => setIsOpen((current) => !current)}
        className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition hover:bg-slate-900/80"
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="relative flex size-2.5 shrink-0" aria-hidden="true">
            {activeCount > 0 && (
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-cyan-400 opacity-40 motion-reduce:animate-none" />
            )}
            <span
              className={`relative inline-flex size-2.5 rounded-full ${
                activeCount > 0 ? "bg-cyan-300" : "bg-slate-600"
              }`}
            />
          </span>
          <span className="min-w-0">
            <span className="block text-xs font-semibold text-slate-100">
              媒体任务队列
            </span>
            <span className="mt-0.5 block text-[10px] text-slate-500">
              {activeCount} 个活动任务 · 图片与视频共用
            </span>
          </span>
        </span>
        <span className="text-[11px] text-cyan-300">
          {isOpen ? "收起" : "展开"}
        </span>
      </button>

      {isOpen && (
        <div
          id="floating-media-queue"
          className="max-h-[min(62vh,34rem)] space-y-2 overflow-y-auto border-t border-slate-800 p-3"
        >
          <div className="grid grid-cols-2 gap-2">
            <HealthChip
              label="H3 视频"
              healthy={videoHealthQuery.data?.status === "healthy"}
              checking={videoHealthQuery.isFetching}
            />
            <HealthChip
              label="HiDream 图片"
              healthy={imageHealthQuery.data?.status === "healthy"}
              checking={imageHealthQuery.isFetching}
            />
          </div>

          {visibleCount === 0 && (
            <div className="rounded-xl border border-dashed border-slate-800 px-3 py-4 text-center">
              <p className="text-xs text-slate-400">当前没有活动任务</p>
              <p className="mt-1 text-[10px] text-slate-600">
                新建图片或视频后会出现在这里。
              </p>
            </div>
          )}

          {videoJobs.map((job) => {
            if (job.isPrivate) {
              return (
                <article
                  key={`video:${job.id}`}
                  className="rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-3"
                >
                  <MediaTypeBadge type="video" />
                  <p className="mt-2 text-xs text-slate-300">
                    其他成员有视频任务进行中
                  </p>
                  <p className="mt-1 text-[10px] text-slate-600">
                    为保护隐私，任务内容仅创建人可见。
                  </p>
                </article>
              );
            }
            const key = `video:${job.id}`;
            const canceling =
              cancelVideoMutation.isPending &&
              cancelVideoMutation.variables.id === job.id;
            const elapsed = formatGenerationElapsed(
              job.startedAt,
              job.finishedAt,
            );
            const videoTitle = job.title?.trim();
            return (
              <article
                key={key}
                className="rounded-xl border border-cyan-400/15 bg-slate-900/70 p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <MediaTypeBadge type="video" />
                    <p className="mt-2 truncate text-xs font-medium text-slate-200">
                      {videoTitle?.length ? videoTitle : job.prompt}
                    </p>
                    <p className="mt-1 text-[10px] text-slate-500">
                      {job.status === "scheduled" && job.scheduledAt
                        ? `定于 ${new Date(job.scheduledAt).toLocaleString()}`
                        : job.status === "running"
                          ? `正在生成${elapsed ? ` · ${elapsed}` : ""}`
                          : "等待 GPU 队列执行"}
                    </p>
                  </div>
                  <QueueStatus status={job.status} />
                </div>
                <div className="mt-3 flex justify-end border-t border-slate-800 pt-2.5">
                  <button
                    type="button"
                    disabled={canceling}
                    onClick={() => {
                      const label = videoTitle?.length
                        ? videoTitle
                        : job.prompt.slice(0, 60);
                      if (window.confirm(`确定取消“${label}”吗？`)) {
                        cancelVideoMutation.mutate({ id: job.id });
                      }
                    }}
                    className="text-[11px] text-rose-300 transition hover:text-rose-200 disabled:opacity-50"
                  >
                    {canceling ? "正在取消…" : "取消任务"}
                  </button>
                </div>
                {messages[key] && (
                  <p className="mt-2 text-[10px] text-cyan-300">
                    {messages[key]}
                  </p>
                )}
              </article>
            );
          })}

          {[...activeImageJobs, ...failedImageJobs].map((job) => {
            const key = `image:${job.id}`;
            const canceling =
              cancelImageMutation.isPending &&
              cancelImageMutation.variables.id === job.id;
            const retrying =
              retryImageMutation.isPending &&
              retryImageMutation.variables.id === job.id;
            const imageTitle = job.title?.trim();
            return (
              <article
                key={key}
                className="rounded-xl border border-violet-400/15 bg-slate-900/70 p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <MediaTypeBadge type="image" />
                    <p className="mt-2 truncate text-xs font-medium text-slate-200">
                      {imageTitle?.length
                        ? imageTitle
                        : job.kind === "edit"
                          ? "图片修改"
                          : job.prompt}
                    </p>
                    <p className="mt-1 text-[10px] text-slate-500">
                      {job.width}×{job.height} · {job.outputCount} 张 · 多样性{" "}
                      {job.diversity} ·{" "}
                      {job.status === "running"
                        ? "正在生成"
                        : job.status === "queued"
                          ? "等待 GPU 队列执行"
                          : "生成失败"}
                    </p>
                  </div>
                  <QueueStatus status={job.status} />
                </div>
                {job.errorMessage && (
                  <p className="mt-2 line-clamp-2 text-[10px] leading-4 text-rose-300/80">
                    {job.errorMessage}
                  </p>
                )}
                <div className="mt-3 flex justify-end border-t border-slate-800 pt-2.5">
                  {job.status === "failed" ? (
                    <button
                      type="button"
                      disabled={retrying}
                      onClick={() => retryImageMutation.mutate({ id: job.id })}
                      className="text-[11px] text-violet-300 transition hover:text-violet-200 disabled:opacity-50"
                    >
                      {retrying ? "正在重试…" : "重试任务"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={canceling}
                      onClick={() => cancelImageMutation.mutate({ id: job.id })}
                      className="text-[11px] text-rose-300 transition hover:text-rose-200 disabled:opacity-50"
                    >
                      {canceling ? "正在取消…" : "取消任务"}
                    </button>
                  )}
                </div>
                {messages[key] && (
                  <p className="mt-2 text-[10px] text-cyan-300">
                    {messages[key]}
                  </p>
                )}
              </article>
            );
          })}
        </div>
      )}
    </aside>
  );
}

function HealthChip({
  label,
  healthy,
  checking,
}: {
  label: string;
  healthy: boolean;
  checking: boolean;
}) {
  const state = healthy ? "正常" : checking ? "检查中" : "异常";
  return (
    <span
      className={`flex min-w-0 items-center gap-1.5 rounded-lg border px-2.5 py-2 text-[10px] ${
        healthy
          ? "border-emerald-400/20 bg-emerald-400/5 text-emerald-300"
          : checking
            ? "border-slate-800 bg-slate-900 text-slate-500"
            : "border-rose-400/20 bg-rose-400/5 text-rose-300"
      }`}
    >
      <span
        className={`size-1.5 shrink-0 rounded-full ${
          healthy ? "bg-emerald-300" : checking ? "bg-slate-600" : "bg-rose-300"
        }`}
      />
      <span className="truncate">
        {label} · {state}
      </span>
    </span>
  );
}

function MediaTypeBadge({ type }: { type: "image" | "video" }) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 font-mono text-[9px] tracking-[0.12em] ${
        type === "image"
          ? "bg-violet-400/10 text-violet-200"
          : "bg-cyan-400/10 text-cyan-200"
      }`}
    >
      {type === "image" ? "IMAGE" : "VIDEO"}
    </span>
  );
}

function QueueStatus({ status }: { status: string }) {
  const labels: Record<string, string> = {
    scheduled: "已定时",
    queued: "排队中",
    running: "生成中",
    failed: "失败",
  };
  const colors: Record<string, string> = {
    scheduled: "bg-amber-400/10 text-amber-300",
    queued: "bg-slate-800 text-slate-300",
    running: "bg-cyan-400/10 text-cyan-300",
    failed: "bg-rose-400/10 text-rose-300",
  };
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] ${
        colors[status] ?? colors.queued
      }`}
    >
      {labels[status] ?? status}
    </span>
  );
}
