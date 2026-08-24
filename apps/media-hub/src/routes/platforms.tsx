import { createFileRoute, Link } from "@tanstack/react-router";

import { authClient } from "~/auth/client";
import { PlatformAccountManagementPanel } from "~/routes/index";

export const Route = createFileRoute("/platforms")({
  component: PlatformManagementPage,
});

function PlatformManagementPage() {
  const sessionQuery = authClient.useSession();

  if (sessionQuery.isPending) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-950 text-sm text-slate-400">
        正在读取平台账号…
      </main>
    );
  }

  const currentUser = sessionQuery.data?.user;
  if (!currentUser) {
    return <SignedOutState description="登录后才能绑定和管理发布平台。" />;
  }

  const isAdmin = currentUser.role === "admin";

  return (
    <main className="min-h-screen bg-slate-950 p-6 text-slate-100">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-col gap-5 border-b border-slate-800 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium tracking-[0.18em] text-cyan-300">
              MEDIA HUB / DISTRIBUTION
            </p>
            <h1 className="mt-2 text-3xl font-semibold">平台管理</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
              连接视频发布渠道、检查账号归属，并集中处理授权状态。
            </p>
          </div>
          <nav
            className="flex flex-wrap items-center gap-2"
            aria-label="管理导航"
          >
            {isAdmin && (
              <Link
                to="/admin/users"
                className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm text-slate-300 transition hover:border-cyan-400/50 hover:text-cyan-200 focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:outline-none"
              >
                用户管理
              </Link>
            )}
            <Link
              to="/"
              className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm text-slate-300 transition hover:border-cyan-400/50 hover:text-cyan-200 focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:outline-none"
            >
              ← 返回生成后台
            </Link>
          </nav>
        </header>

        <PlatformAccountManagementPanel isAdmin={isAdmin} />
      </div>
    </main>
  );
}

function SignedOutState({ description }: { description: string }) {
  return (
    <main className="grid min-h-screen place-items-center bg-slate-950 p-6 text-slate-100">
      <section className="max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center shadow-2xl">
        <p className="text-sm font-medium tracking-[0.18em] text-cyan-300">
          PUMPKII MEDIA HUB
        </p>
        <h1 className="mt-3 text-2xl font-semibold">请先登录</h1>
        <p className="mt-3 text-sm leading-6 text-slate-400">{description}</p>
        <Link
          to="/"
          className="mt-6 inline-flex rounded-xl bg-cyan-400 px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 focus-visible:ring-2 focus-visible:ring-cyan-200 focus-visible:outline-none"
        >
          返回登录
        </Link>
      </section>
    </main>
  );
}
