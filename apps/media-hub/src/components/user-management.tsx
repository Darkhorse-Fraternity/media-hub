import type { FormEvent } from "react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useTRPC } from "~/lib/trpc";

export function UserManagementPanel({
  currentUserId,
}: {
  currentUserId: string;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("123456");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [accountMessage, setAccountMessage] = useState<string | null>(null);
  const [passwordEditorUserId, setPasswordEditorUserId] = useState<
    string | null
  >(null);
  const [newPassword, setNewPassword] = useState("123456");

  const usersQuery = useQuery(trpc.admin.user.all.queryOptions());
  const refreshUsers = () =>
    queryClient.invalidateQueries({
      queryKey: trpc.admin.user.all.queryKey(),
    });
  const createUserMutation = useMutation(
    trpc.admin.user.createMediaHub.mutationOptions({
      onSuccess: () => {
        setName("");
        setEmail("");
        setPassword("123456");
        setRole("member");
        setAccountMessage("账号已创建，可以立即登录。 ");
        void refreshUsers();
      },
      onError: (error) => setAccountMessage(error.message),
    }),
  );
  const updateUserMutation = useMutation(
    trpc.admin.user.update.mutationOptions({
      onSuccess: () => {
        setAccountMessage("账号设置已更新。 ");
        void refreshUsers();
      },
      onError: (error) => setAccountMessage(error.message),
    }),
  );
  const setPasswordMutation = useMutation(
    trpc.admin.user.setPassword.mutationOptions({
      onSuccess: () => {
        setAccountMessage("密码已更新，并使用 bcrypt 单向哈希保存。");
        setPasswordEditorUserId(null);
        setNewPassword("123456");
      },
      onError: (error) => setAccountMessage(error.message),
    }),
  );

  const createUser = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAccountMessage(null);
    createUserMutation.mutate({
      name: name.trim(),
      email: email.trim(),
      password,
      role,
    });
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-cyan-400/20 bg-slate-900 shadow-xl">
      <div className="border-b border-slate-800 px-6 py-5">
        <p className="text-xs font-semibold tracking-[0.18em] text-cyan-300">
          ACCESS CONTROL
        </p>
        <h2 className="mt-2 text-lg font-semibold">后台登录账号</h2>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          新账号由管理员创建；停用后将无法继续登录。密码不会在后台回显。
        </p>
      </div>
      <div className="grid lg:grid-cols-[minmax(320px,0.75fr)_minmax(0,1.25fr)]">
        <form
          onSubmit={createUser}
          className="border-b border-slate-800 p-6 lg:border-r lg:border-b-0"
        >
          <h3 className="text-sm font-medium text-slate-200">新增账号</h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            <label className="text-xs text-slate-400">
              姓名
              <input
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-cyan-400"
              />
            </label>
            <label className="text-xs text-slate-400">
              邮箱
              <input
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-cyan-400"
              />
            </label>
            <label className="text-xs text-slate-400">
              初始密码
              <input
                type="password"
                autoComplete="new-password"
                minLength={6}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="默认 123456，可直接修改"
                className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-cyan-400"
              />
            </label>
            <label className="text-xs text-slate-400">
              权限
              <select
                value={role}
                onChange={(event) =>
                  setRole(event.target.value as "admin" | "member")
                }
                className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-cyan-400"
              >
                <option value="member">普通成员</option>
                <option value="admin">管理员</option>
              </select>
            </label>
          </div>
          <button
            type="submit"
            disabled={
              createUserMutation.isPending ||
              !name.trim() ||
              !email.trim() ||
              password.length < 6
            }
            className="mt-4 w-full rounded-xl bg-cyan-400 px-4 py-2.5 text-xs font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {createUserMutation.isPending ? "正在创建…" : "创建登录账号"}
          </button>
        </form>

        <div className="p-6">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-slate-200">已有账号</h3>
            <span className="text-xs text-slate-500">
              {usersQuery.data?.length ?? 0} 个
            </span>
          </div>
          {usersQuery.isLoading ? (
            <p className="mt-4 text-xs text-slate-500">正在读取账号…</p>
          ) : usersQuery.isError ? (
            <p className="mt-4 text-xs text-rose-300">
              {usersQuery.error.message}
            </p>
          ) : (
            <div className="mt-4 space-y-2">
              {(usersQuery.data ?? []).map((user) => {
                const isCurrentUser = user.id === currentUserId;
                const isUpdatingThisUser =
                  updateUserMutation.isPending &&
                  updateUserMutation.variables.id === user.id;
                return (
                  <article
                    key={user.id}
                    className="rounded-xl border border-slate-800 bg-slate-950/70 px-4 py-3"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-medium text-slate-200">
                            {user.name}
                          </p>
                          {isCurrentUser && (
                            <span className="rounded-full bg-cyan-400/10 px-2 py-0.5 text-[10px] text-cyan-300">
                              当前账号
                            </span>
                          )}
                          {user.banned && (
                            <span className="rounded-full bg-rose-400/10 px-2 py-0.5 text-[10px] text-rose-300">
                              已停用
                            </span>
                          )}
                        </div>
                        <p className="mt-1 truncate text-xs text-slate-500">
                          {user.email}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          aria-label={`设置 ${user.name} 的权限`}
                          value={user.role}
                          disabled={isCurrentUser || isUpdatingThisUser}
                          onChange={(event) => {
                            setAccountMessage(null);
                            updateUserMutation.mutate({
                              id: user.id,
                              role: event.target.value as "admin" | "member",
                            });
                          }}
                          className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-2 text-xs text-slate-300 outline-none focus:border-cyan-400 disabled:opacity-50"
                        >
                          <option value="member">普通成员</option>
                          <option value="admin">管理员</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => {
                            setAccountMessage(null);
                            setNewPassword("123456");
                            setPasswordEditorUserId((current) =>
                              current === user.id ? null : user.id,
                            );
                          }}
                          className="rounded-lg border border-cyan-400/20 px-3 py-2 text-xs text-cyan-300 transition hover:bg-cyan-400/10"
                        >
                          改密码
                        </button>
                        <button
                          type="button"
                          disabled={isCurrentUser || isUpdatingThisUser}
                          onClick={() => {
                            setAccountMessage(null);
                            updateUserMutation.mutate({
                              id: user.id,
                              banned: !user.banned,
                              banReason: user.banned
                                ? undefined
                                : "由 Media Hub 管理员停用",
                            });
                          }}
                          className={`rounded-lg border px-3 py-2 text-xs transition disabled:cursor-not-allowed disabled:opacity-40 ${
                            user.banned
                              ? "border-emerald-400/30 text-emerald-300 hover:bg-emerald-400/10"
                              : "border-rose-400/20 text-rose-300 hover:bg-rose-400/10"
                          }`}
                        >
                          {isUpdatingThisUser
                            ? "更新中…"
                            : user.banned
                              ? "启用"
                              : "停用"}
                        </button>
                      </div>
                    </div>
                    {passwordEditorUserId === user.id && (
                      <form
                        className="mt-3 flex flex-col gap-2 border-t border-slate-800 pt-3 sm:flex-row"
                        onSubmit={(event) => {
                          event.preventDefault();
                          setAccountMessage(null);
                          setPasswordMutation.mutate({
                            id: user.id,
                            password: newPassword,
                          });
                        }}
                      >
                        <label className="min-w-0 flex-1 text-xs text-slate-400">
                          新密码
                          <input
                            type="password"
                            autoComplete="new-password"
                            minLength={6}
                            maxLength={128}
                            required
                            value={newPassword}
                            onChange={(event) =>
                              setNewPassword(event.target.value)
                            }
                            className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100 outline-none focus:border-cyan-400"
                          />
                        </label>
                        <button
                          type="submit"
                          disabled={
                            setPasswordMutation.isPending ||
                            newPassword.length < 6
                          }
                          className="self-end rounded-lg bg-cyan-400 px-4 py-2 text-xs font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:opacity-45"
                        >
                          {setPasswordMutation.isPending
                            ? "保存中…"
                            : "保存新密码"}
                        </button>
                      </form>
                    )}
                  </article>
                );
              })}
            </div>
          )}
          {accountMessage && (
            <p className="mt-3 text-xs text-cyan-300">{accountMessage}</p>
          )}
        </div>
      </div>
    </section>
  );
}
