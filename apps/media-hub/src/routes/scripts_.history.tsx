import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import { authClient } from "~/auth/client";
import { MediaHubAccountMenu } from "~/components/media-hub-account-menu";
import { useTRPC } from "~/lib/trpc";

export const Route = createFileRoute("/scripts_/history")({
  component: ScriptHistoryPage,
  head: () => ({
    meta: [{ title: "历史脚本 · Pumpkii Media Hub" }],
  }),
});

function ScriptHistoryPage() {
  const sessionQuery = authClient.useSession();

  if (sessionQuery.isPending) {
    return <HistoryState title="正在读取历史脚本…" />;
  }

  if (!sessionQuery.data?.user) {
    return (
      <HistoryState
        title="登录后查看历史脚本"
        description="脚本按账号隔离，请先返回登录。"
      />
    );
  }

  return (
    <AuthenticatedScriptHistory
      userName={sessionQuery.data.user.name}
      userEmail={sessionQuery.data.user.email}
      isAdmin={sessionQuery.data.user.role === "admin"}
    />
  );
}

function AuthenticatedScriptHistory({
  userName,
  userEmail,
  isAdmin,
}: {
  userName: string;
  userEmail: string;
  isAdmin: boolean;
}) {
  const trpc = useTRPC();
  const listQuery = useQuery(
    trpc.mediaHub.script.list.queryOptions(
      { page: 1, pageSize: 100 },
      {
        refetchInterval: 10_000,
        refetchOnMount: "always",
        refetchOnWindowFocus: true,
      },
    ),
  );

  return (
    <main className="min-h-screen bg-slate-950 p-4 text-slate-100 sm:p-6">
      <div className="mx-auto max-w-6xl">
        <header className="relative border-b border-slate-800 pb-6">
          <div className="max-w-3xl pr-24 sm:pr-28">
            <p className="text-sm text-amber-300">Pumpkii Script Studio</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
              历史脚本
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-400">
              选择一份脚本进入独立详情页。通过网页或 OpenAPI
              新建的内容都会出现在这里。
            </p>
          </div>
          <div className="absolute top-0 right-0 z-50">
            <MediaHubAccountMenu
              user={{ name: userName, email: userEmail }}
              isAdmin={isAdmin}
              onSignedOut={() => window.location.assign("/")}
            />
          </div>
          <nav className="mt-5 flex flex-wrap gap-2" aria-label="脚本导航">
            <Link
              to="/scripts"
              className="bg-amber-300 px-4 py-2 text-sm font-semibold text-slate-950"
            >
              新建脚本
            </Link>
            <Link
              to="/"
              className="border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-cyan-400 hover:text-cyan-200"
            >
              快速生成
            </Link>
            <Link
              to="/images"
              className="border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-violet-400 hover:text-violet-200"
            >
              图片素材
            </Link>
          </nav>
        </header>

        <section className="mt-8" aria-labelledby="script-history-heading">
          <div className="flex items-end justify-between gap-4 border-b border-slate-800 pb-3">
            <div>
              <h2 id="script-history-heading" className="text-lg font-semibold">
                我的脚本
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                最近更新的脚本排在最前面
              </p>
            </div>
            <span className="text-sm text-slate-400">
              {listQuery.data?.total ?? 0} 份
            </span>
          </div>

          {listQuery.isPending ? (
            <p className="py-16 text-center text-sm text-slate-500">
              正在读取脚本…
            </p>
          ) : listQuery.isError ? (
            <div className="mt-6 border-l-2 border-rose-400 bg-rose-400/5 px-5 py-4">
              <p className="text-sm text-rose-200">历史脚本读取失败</p>
              <p className="mt-1 text-xs text-slate-500">
                {listQuery.error.message}
              </p>
            </div>
          ) : listQuery.data.rows.length === 0 ? (
            <div className="py-20 text-center">
              <p className="text-lg text-slate-300">还没有历史脚本</p>
              <p className="mt-2 text-sm text-slate-500">
                从一段创作简报开始，AI 会把它拆成可生成的镜头。
              </p>
              <Link
                to="/scripts"
                className="mt-6 inline-flex bg-amber-300 px-5 py-2.5 text-sm font-semibold text-slate-950"
              >
                创建第一份脚本
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-slate-800">
              {listQuery.data.rows.map((script, index) => (
                <Link
                  key={script.id}
                  to="/scripts/$scriptId"
                  params={{ scriptId: script.id }}
                  className="group grid gap-4 py-5 outline-none hover:bg-slate-900/45 focus-visible:bg-slate-900/60 sm:grid-cols-[44px_minmax(0,1fr)_auto] sm:items-center sm:px-4"
                >
                  <span className="font-mono text-xs text-slate-600">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-base font-medium text-slate-100 group-hover:text-amber-200">
                      {script.title}
                    </span>
                    <span className="mt-1 block truncate text-sm text-slate-500">
                      {script.brief}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 sm:justify-end">
                    <span>
                      {script.shotCount} 镜 / {script.totalDurationSeconds} 秒
                    </span>
                    <span
                      className={
                        script.copyStatus === "approved"
                          ? "text-emerald-300"
                          : "text-amber-200"
                      }
                    >
                      {script.copyStatus === "approved"
                        ? "文案已确认"
                        : "待确认"}
                    </span>
                    <time dateTime={script.updatedAt.toISOString()}>
                      {formatHistoryDate(script.updatedAt)}
                    </time>
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function formatHistoryDate(value: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function HistoryState({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <main className="grid min-h-screen place-items-center bg-slate-950 p-6 text-slate-100">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold">{title}</h1>
        {description && (
          <p className="mt-2 text-sm leading-6 text-slate-400">{description}</p>
        )}
        <Link
          to="/"
          className="mt-6 inline-flex bg-amber-300 px-4 py-2 text-sm font-semibold text-slate-950"
        >
          返回登录
        </Link>
      </div>
    </main>
  );
}
