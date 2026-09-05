import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";

import type { ContentLanguage } from "~/lib/content-language";
import { authClient } from "~/auth/client";
import { VideoEditWorkspace } from "~/components/video-edit-workspace";
import { useTRPC } from "~/lib/trpc";

export const Route = createFileRoute("/generations/$jobId/edit")({
  component: VideoEditPage,
  head: () => ({
    meta: [{ title: "修改视频 · Pumpkii Media Hub" }],
  }),
});

function VideoEditPage() {
  const sessionQuery = authClient.useSession();

  if (sessionQuery.isPending) {
    return <EditPageState title="正在读取登录状态…" />;
  }

  if (!sessionQuery.data?.user) {
    return (
      <EditPageState
        title="需要登录后修改视频"
        description="返回 Media Hub 登录，然后重新打开修改页面。"
        action={
          <Link
            to="/"
            className="rounded-lg bg-cyan-300 px-4 py-2 text-xs font-semibold text-slate-950"
          >
            返回登录
          </Link>
        }
      />
    );
  }

  return <AuthenticatedVideoEditPage />;
}

function AuthenticatedVideoEditPage() {
  const { jobId } = Route.useParams();
  const trpc = useTRPC();
  const navigate = useNavigate();
  const jobQuery = useQuery(
    trpc.mediaHub.generation.getById.queryOptions({ id: jobId }),
  );

  if (jobQuery.isLoading) {
    return <EditPageState title="正在加载源视频…" />;
  }

  if (jobQuery.isError) {
    return (
      <EditPageState
        title="无法打开这个视频"
        description={jobQuery.error.message}
        action={
          <Link
            to="/"
            className="rounded-lg border border-slate-700 px-4 py-2 text-xs text-slate-200"
          >
            返回生成队列
          </Link>
        }
      />
    );
  }

  const job = jobQuery.data;
  if (job?.status !== "succeeded" || !job.outputStorageKey) {
    return (
      <EditPageState
        title="这个视频暂时不能修改"
        description="只有已经生成完成且文件仍然存在的视频可以创建 Ref2VA 修改任务。"
        action={
          <Link
            to="/"
            className="rounded-lg border border-slate-700 px-4 py-2 text-xs text-slate-200"
          >
            返回生成队列
          </Link>
        }
      />
    );
  }

  const sourceTitle = job.title?.trim() ?? job.prompt;
  const playbackUrl = `/api/media-hub/generation/${encodeURIComponent(job.id)}/video`;

  return (
    <main className="min-h-screen bg-[#050817] text-slate-100">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_12%_8%,rgba(34,211,238,0.08),transparent_28%),radial-gradient(circle_at_88%_24%,rgba(139,92,246,0.12),transparent_34%)]"
      />
      <div className="relative mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-slate-800/80 pb-5">
          <div>
            {job.scriptId ? (
              <Link
                to="/scripts/$scriptId"
                params={{ scriptId: job.scriptId }}
                className="inline-flex items-center gap-2 text-xs text-cyan-300 transition hover:text-cyan-200"
              >
                <span aria-hidden="true">←</span>
                返回脚本镜头
              </Link>
            ) : (
              <Link
                to="/"
                className="inline-flex items-center gap-2 text-xs text-cyan-300 transition hover:text-cyan-200"
              >
                <span aria-hidden="true">←</span>
                返回生成队列
              </Link>
            )}
            <p className="mt-5 text-[11px] font-semibold tracking-[0.2em] text-slate-500 uppercase">
              Pumpkii Media Hub / Ref2VA
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              修改视频
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
              对源视频指定时间片进行局部重绘，保留未选择片段和原始音轨。
            </p>
          </div>
          <span className="rounded-full border border-violet-300/20 bg-violet-300/5 px-3 py-1.5 font-mono text-[10px] text-violet-200">
            {job.durationSeconds}s · {job.width}×{job.height} · {job.fps} FPS
          </span>
        </header>

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,0.92fr)_minmax(520px,1.08fr)]">
          <aside className="space-y-4 lg:sticky lg:top-6">
            <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/80">
              <div className="border-b border-slate-800 px-4 py-3">
                <p className="text-[10px] font-semibold tracking-[0.16em] text-cyan-400 uppercase">
                  Source video
                </p>
                <h2 className="mt-1 line-clamp-2 text-sm font-medium text-slate-100">
                  {sourceTitle}
                </h2>
              </div>
              <video
                controls
                playsInline
                preload="metadata"
                src={playbackUrl}
                aria-label={`播放源视频：${sourceTitle}`}
                className="aspect-video w-full bg-black object-contain"
              >
                您的浏览器不支持视频播放。
              </video>
              <div className="flex items-center justify-between gap-3 border-t border-slate-800 px-4 py-3">
                <span className="font-mono text-[10px] text-slate-600">
                  {job.id}
                </span>
                <div className="flex gap-4">
                  <a
                    href={`${playbackUrl}?download=1`}
                    download
                    className="text-xs text-cyan-300 hover:text-cyan-200"
                  >
                    下载源视频
                  </a>
                  <a
                    href={playbackUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-cyan-300 hover:text-cyan-200"
                  >
                    新窗口打开
                  </a>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
              <p className="text-xs font-medium text-slate-300">原始生成描述</p>
              <p className="mt-2 max-h-40 overflow-y-auto text-xs leading-5 whitespace-pre-wrap text-slate-500">
                {job.prompt}
              </p>
            </section>
          </aside>

          <VideoEditWorkspace
            sourceJobId={job.id}
            sourceTitle={sourceTitle}
            durationSeconds={job.durationSeconds}
            initialLanguage={job.language as ContentLanguage}
            onCreated={(newJobId) => {
              if (job.scriptId) {
                void navigate({
                  to: "/scripts/$scriptId",
                  params: { scriptId: job.scriptId },
                });
                return;
              }
              void navigate({
                to: "/",
                hash: `generation-job-${newJobId}`,
              });
            }}
          />
        </div>
      </div>
    </main>
  );
}

function EditPageState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#050817] px-6 text-slate-100">
      <section className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-950/80 p-6 text-center">
        <div className="mx-auto size-8 animate-pulse rounded-full border border-violet-300/30 bg-violet-300/10" />
        <h1 className="mt-4 text-lg font-semibold">{title}</h1>
        {description && (
          <p className="mt-2 text-sm leading-6 text-slate-400">{description}</p>
        )}
        {action && <div className="mt-5 flex justify-center">{action}</div>}
      </section>
    </main>
  );
}
