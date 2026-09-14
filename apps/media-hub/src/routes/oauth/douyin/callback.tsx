import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";

import { useTRPC } from "~/lib/trpc";

interface SearchParams {
  code?: string;
  state?: string;
  error?: string;
  description?: string;
}

export const Route = createFileRoute("/oauth/douyin/callback")({
  component: DouyinOAuthCallbackPage,
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    code: typeof search.code === "string" ? search.code : undefined,
    state: typeof search.state === "string" ? search.state : undefined,
    error: typeof search.error === "string" ? search.error : undefined,
    description:
      typeof search.description === "string" ? search.description : undefined,
  }),
});

function DouyinOAuthCallbackPage() {
  const router = useRouter();
  const trpc = useTRPC();
  const { code, state, error, description } = Route.useSearch();
  const [status, setStatus] = useState<"running" | "ok" | "error">("running");
  const [message, setMessage] = useState("正在完成抖音授权…");

  const callback = useMutation(
    trpc.mediaHub.douyin.oauthCallback.mutationOptions({
      onSuccess: (data) => {
        setStatus("ok");
        setMessage(
          `已绑定抖音账号：${data.accountLabel}${data.refreshed ? "（已更新现有授权）" : ""}`,
        );
        setTimeout(() => void router.navigate({ href: data.returnTo }), 1200);
      },
      onError: (callbackError) => {
        setStatus("error");
        setMessage(
          callbackError.message.includes("State expired")
            ? "授权链接已过期（有效期 10 分钟）。请返回平台账号页面重新授权。"
            : callbackError.message,
        );
      },
    }),
  );

  useEffect(() => {
    if (error) {
      setStatus("error");
      setMessage(`抖音拒绝授权：${description ?? error}`);
      return;
    }
    if (!code || !state) {
      setStatus("error");
      setMessage("缺少 code 或 state 参数");
      return;
    }
    callback.mutate({ code, state });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4 dark:bg-gray-900">
      <div className="w-full max-w-md rounded-lg bg-white p-8 shadow dark:bg-gray-800">
        <h1 className="mb-2 text-xl font-semibold text-gray-900 dark:text-white">
          {status === "running" && "正在处理…"}
          {status === "ok" && "授权成功"}
          {status === "error" && "授权失败"}
        </h1>
        <p
          className={
            status === "error"
              ? "text-red-600 dark:text-red-400"
              : "text-gray-600 dark:text-gray-300"
          }
        >
          {message}
        </p>
        {status === "error" && (
          <button
            type="button"
            className="bg-primary hover:bg-primary/90 mt-6 w-full rounded-md px-4 py-2 text-sm font-medium text-white"
            onClick={() => router.navigate({ to: "/" })}
          >
            返回首页
          </button>
        )}
      </div>
    </div>
  );
}
