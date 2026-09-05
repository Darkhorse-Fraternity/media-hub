import { createFileRoute, Link } from "@tanstack/react-router";

import { authClient } from "~/auth/client";
import { AgentApiManagementPanel } from "~/routes/index";

export const Route = createFileRoute("/agent-api")({
  component: AgentApiPage,
});

function AgentApiPage() {
  const sessionQuery = authClient.useSession();

  if (sessionQuery.isPending) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-950 text-sm text-slate-400">
        正在读取 Agent API…
      </main>
    );
  }

  if (!sessionQuery.data?.user) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-950 p-6 text-slate-100">
        <section className="max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center shadow-2xl">
          <p className="text-sm font-medium tracking-[0.18em] text-violet-300">
            MEDIA HUB AGENT API
          </p>
          <h1 className="mt-3 text-2xl font-semibold">请先登录</h1>
          <p className="mt-3 text-sm leading-6 text-slate-400">
            登录后才能生成和管理你的 Agent API Token。
          </p>
          <Link
            to="/"
            className="mt-6 inline-flex rounded-xl bg-violet-400 px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-violet-300 focus-visible:ring-2 focus-visible:ring-violet-200 focus-visible:outline-none"
          >
            返回登录
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 p-6 text-slate-100">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-col gap-5 border-b border-slate-800 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium tracking-[0.18em] text-violet-300">
              MEDIA HUB / DEVELOPER ACCESS
            </p>
            <h1 className="mt-2 text-3xl font-semibold">Agent API</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
              管理当前账号的 Bearer Token，查看可调用的 OpenAPI
              接口和完整接口定义。
            </p>
          </div>
          <nav
            className="flex flex-wrap items-center gap-2"
            aria-label="Agent API 导航"
          >
            <Link
              to="/settings"
              className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm text-slate-300 transition hover:border-violet-400/50 hover:text-violet-200 focus-visible:ring-2 focus-visible:ring-violet-300 focus-visible:outline-none"
            >
              账号设置
            </Link>
            <Link
              to="/"
              className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm text-slate-300 transition hover:border-violet-400/50 hover:text-violet-200 focus-visible:ring-2 focus-visible:ring-violet-300 focus-visible:outline-none"
            >
              ← 返回生成后台
            </Link>
          </nav>
        </header>

        <AgentApiManagementPanel />
      </div>
    </main>
  );
}
