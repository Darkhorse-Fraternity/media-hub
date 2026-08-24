import { Link } from "@tanstack/react-router";

import { authClient } from "~/auth/client";

interface MediaHubAccountMenuProps {
  user: { name: string; email: string };
  isAdmin: boolean;
  agentApiOpen?: boolean;
  onAgentApi?: () => void;
  onSignedOut: () => void;
}

export function MediaHubAccountMenu({
  user,
  isAdmin,
  agentApiOpen = false,
  onAgentApi,
  onSignedOut,
}: MediaHubAccountMenuProps) {
  const closeMenu = (target: HTMLElement) => {
    target.closest("details")?.removeAttribute("open");
  };

  return (
    <details className="group relative">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-sm text-slate-300 transition hover:border-slate-500 hover:text-white focus-visible:ring-2 focus-visible:ring-violet-300 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
        管理
        <span
          aria-hidden="true"
          className="text-[10px] text-slate-500 transition group-open:rotate-180"
        >
          ▼
        </span>
      </summary>
      <div className="absolute top-[calc(100%+0.6rem)] right-0 z-50 w-64 overflow-hidden rounded-2xl border border-slate-700 bg-slate-900/95 p-2 shadow-2xl shadow-black/50 backdrop-blur-xl">
        <div className="border-b border-slate-800 px-3 py-2.5">
          <p className="truncate text-sm font-medium text-slate-100">
            {user.name}
          </p>
          <p className="mt-0.5 truncate text-xs text-slate-500">{user.email}</p>
        </div>
        <nav className="grid gap-1 py-2" aria-label="管理菜单">
          <Link
            to="/platforms"
            className="rounded-lg px-3 py-2 text-sm text-slate-300 transition hover:bg-slate-800 hover:text-cyan-200"
          >
            平台管理
          </Link>
          {isAdmin && (
            <Link
              to="/admin/users"
              className="rounded-lg px-3 py-2 text-sm text-slate-300 transition hover:bg-slate-800 hover:text-cyan-200"
            >
              用户管理
            </Link>
          )}
          <Link
            to="/settings"
            className="rounded-lg px-3 py-2 text-sm text-slate-300 transition hover:bg-slate-800 hover:text-cyan-200"
          >
            设置
          </Link>
          {onAgentApi && (
            <button
              type="button"
              onClick={(event) => {
                closeMenu(event.currentTarget);
                onAgentApi();
              }}
              className={`rounded-lg px-3 py-2 text-left text-sm transition hover:bg-slate-800 ${
                agentApiOpen ? "text-violet-200" : "text-slate-300"
              }`}
            >
              Agent API
            </button>
          )}
        </nav>
        <button
          type="button"
          onClick={(event) => {
            closeMenu(event.currentTarget);
            void authClient.signOut({
              fetchOptions: { onSuccess: onSignedOut },
            });
          }}
          className="w-full border-t border-slate-800 px-3 py-2.5 text-left text-sm text-slate-500 transition hover:bg-rose-400/10 hover:text-rose-300"
        >
          退出登录
        </button>
      </div>
    </details>
  );
}
