import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useTRPC } from "~/lib/trpc";

function platformDisplayName(platform: string): string {
  if (platform === "youtube") return "YouTube";
  if (platform === "instagram") return "Instagram";
  if (platform === "douyin") return "抖音";
  return platform;
}

function platformBadgeClass(platform: string): string {
  if (platform === "youtube") return "bg-red-400/10 text-red-300";
  if (platform === "instagram") return "bg-fuchsia-400/10 text-fuchsia-300";
  if (platform === "douyin") return "bg-cyan-400/10 text-cyan-200";
  return "bg-slate-400/10 text-slate-300";
}

export function PlatformAccountManagementPanel({
  isAdmin,
}: {
  isAdmin: boolean;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [platformMessage, setPlatformMessage] = useState<string | null>(null);
  const accountsQuery = useQuery(trpc.mediaHub.account.list.queryOptions({}));
  const usersQuery = useQuery({
    ...trpc.admin.user.all.queryOptions(),
    enabled: isAdmin,
  });
  const refreshAccounts = () =>
    queryClient.invalidateQueries({
      queryKey: trpc.mediaHub.account.list.queryKey(),
    });
  const youtubeOAuthMutation = useMutation(
    trpc.mediaHub.youtube.oauthStart.mutationOptions({
      onSuccess: ({ url }) => window.location.assign(url),
      onError: (error) => setPlatformMessage(error.message),
    }),
  );
  const instagramOAuthMutation = useMutation(
    trpc.mediaHub.instagram.oauthStart.mutationOptions({
      onSuccess: ({ url }) => window.location.assign(url),
      onError: (error) => setPlatformMessage(error.message),
    }),
  );
  const douyinOAuthMutation = useMutation(
    trpc.mediaHub.douyin.oauthStart.mutationOptions({
      onSuccess: ({ url }) => window.location.assign(url),
      onError: (error) => setPlatformMessage(error.message),
    }),
  );
  const removeMutation = useMutation(
    trpc.mediaHub.account.remove.mutationOptions({
      onSuccess: () => {
        setPlatformMessage("平台账号已解绑");
        void refreshAccounts();
      },
      onError: (error) => setPlatformMessage(error.message),
    }),
  );
  const assignOwnerMutation = useMutation(
    trpc.mediaHub.account.assignOwner.mutationOptions({
      onSuccess: ({ owner }) => {
        setPlatformMessage(`账号已转交给 ${owner.email}`);
        void refreshAccounts();
      },
      onError: (error) => setPlatformMessage(error.message),
    }),
  );

  const platformAccounts = (accountsQuery.data ?? []).filter((account) =>
    ["youtube", "instagram", "douyin"].includes(account.platform),
  );
  const isStartingOAuth =
    youtubeOAuthMutation.isPending ||
    instagramOAuthMutation.isPending ||
    douyinOAuthMutation.isPending;

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-xl">
      <div className="flex flex-col gap-4 border-b border-slate-800 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold tracking-[0.18em] text-cyan-300">
            PUBLISHING ACCOUNTS
          </p>
          <h2 className="mt-2 text-lg font-semibold">平台账号管理</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            {isAdmin
              ? "管理员可查看全部平台账号、转交归属和解绑；发布时也可选择全部账号。"
              : "这里只显示你自己的平台账号；生成视频后可直接选择这些账号发布。"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={isStartingOAuth}
            onClick={() => {
              setPlatformMessage(null);
              youtubeOAuthMutation.mutate({ returnTo: "/platforms" });
            }}
            className="rounded-xl border border-red-400/30 bg-red-400/5 px-3 py-2 text-xs font-medium text-red-200 transition hover:bg-red-400/10 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {youtubeOAuthMutation.isPending ? "正在跳转…" : "绑定 YouTube"}
          </button>
          <button
            type="button"
            disabled={isStartingOAuth}
            onClick={() => {
              setPlatformMessage(null);
              instagramOAuthMutation.mutate();
            }}
            className="rounded-xl border border-fuchsia-400/30 bg-fuchsia-400/5 px-3 py-2 text-xs font-medium text-fuchsia-200 transition hover:bg-fuchsia-400/10 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {instagramOAuthMutation.isPending ? "正在跳转…" : "绑定 Instagram"}
          </button>
          <button
            type="button"
            disabled={isStartingOAuth}
            onClick={() => {
              setPlatformMessage(null);
              douyinOAuthMutation.mutate({ returnTo: "/platforms" });
            }}
            className="rounded-xl border border-cyan-400/30 bg-cyan-400/5 px-3 py-2 text-xs font-medium text-cyan-200 transition hover:bg-cyan-400/10 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {douyinOAuthMutation.isPending ? "正在跳转…" : "绑定抖音"}
          </button>
        </div>
      </div>

      <div className="p-6">
        {accountsQuery.isLoading ? (
          <p className="text-xs text-slate-500">正在读取平台账号…</p>
        ) : accountsQuery.isError ? (
          <p className="text-xs text-rose-300">{accountsQuery.error.message}</p>
        ) : platformAccounts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-700 px-4 py-8 text-center">
            <p className="text-sm text-slate-300">还没有绑定平台账号</p>
            <p className="mt-1 text-xs text-slate-500">
              使用上方按钮完成 YouTube、Instagram 或抖音授权。
            </p>
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {platformAccounts.map((account) => {
              const isRemoving =
                removeMutation.isPending &&
                removeMutation.variables.id === account.id;
              const isAssigning =
                assignOwnerMutation.isPending &&
                assignOwnerMutation.variables.id === account.id;
              return (
                <article
                  key={account.id}
                  className="rounded-xl border border-slate-800 bg-slate-950/70 p-4"
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={`rounded-md px-2 py-1 text-[10px] font-semibold tracking-wide uppercase ${platformBadgeClass(account.platform)}`}
                    >
                      {platformDisplayName(account.platform)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-200">
                        {account.accountLabel}
                      </p>
                      <p className="mt-1 truncate text-[11px] text-slate-600">
                        {account.externalAccountId}
                      </p>
                      {isAdmin && account.owner && (
                        <p className="mt-2 text-xs text-slate-400">
                          当前归属：{account.owner.name}（{account.owner.email}
                          ）
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 flex flex-col gap-2 border-t border-slate-800 pt-3 sm:flex-row">
                    {isAdmin && (
                      <select
                        aria-label={`转交 ${account.accountLabel} 的归属`}
                        value={account.createdBy}
                        disabled={isAssigning || usersQuery.isLoading}
                        onChange={(event) => {
                          setPlatformMessage(null);
                          assignOwnerMutation.mutate({
                            id: account.id,
                            userId: event.target.value,
                          });
                        }}
                        className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-xs text-slate-300 outline-none focus:border-cyan-400 disabled:opacity-50"
                      >
                        {(usersQuery.data ?? []).map((user) => (
                          <option key={user.id} value={user.id}>
                            {user.email}
                          </option>
                        ))}
                      </select>
                    )}
                    <button
                      type="button"
                      disabled={isRemoving || isAssigning}
                      onClick={() => {
                        if (
                          !window.confirm(
                            `确认解绑 ${account.accountLabel}？平台侧的 OAuth 授权不会自动撤销。`,
                          )
                        )
                          return;
                        setPlatformMessage(null);
                        removeMutation.mutate({ id: account.id });
                      }}
                      className="rounded-lg border border-rose-400/20 px-3 py-2 text-xs text-rose-300 transition hover:bg-rose-400/10 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      {isRemoving ? "解绑中…" : "解绑"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
        {platformMessage && (
          <p className="mt-3 text-xs text-cyan-300">{platformMessage}</p>
        )}
      </div>
    </section>
  );
}
