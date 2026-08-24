import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";

import { useTRPC } from "~/lib/trpc";

interface SearchParams {
  code?: string;
  state?: string;
  error?: string;
}

export const Route = createFileRoute("/oauth/youtube/callback")({
  component: YouTubeOAuthCallbackPage,
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    code: typeof search.code === "string" ? search.code : undefined,
    state: typeof search.state === "string" ? search.state : undefined,
    error: typeof search.error === "string" ? search.error : undefined,
  }),
});

function YouTubeOAuthCallbackPage() {
  const router = useRouter();
  const trpc = useTRPC();
  const { code, state, error: googleError } = Route.useSearch();

  const [status, setStatus] = useState<"running" | "ok" | "error">("running");
  const [message, setMessage] = useState<string>("正在完成 YouTube 授权…");

  const callback = useMutation(
    trpc.mediaHub.youtube.oauthCallback.mutationOptions({
      onSuccess: (data) => {
        setStatus("ok");
        setMessage(
          `已绑定 YouTube 频道：${data.accountLabel}${data.refreshed ? "（已更新现有授权）" : ""}`,
        );
        // 延迟跳转让用户看到成功提示
        setTimeout(() => {
          void router.navigate({ href: data.returnTo });
        }, 1200);
      },
      onError: (err) => {
        setStatus("error");
        const raw = err.message;
        const friendly = raw.includes("State expired")
          ? "授权链接已过期（有效期 10 分钟）。请返回 Media Hub 的平台账号页面重新授权。"
          : raw;
        setMessage(friendly);
      },
    }),
  );

  useEffect(() => {
    if (googleError) {
      setStatus("error");
      setMessage(`Google 拒绝授权：${googleError}`);
      return;
    }
    if (!code || !state) {
      setStatus("error");
      setMessage("缺少 code 或 state 参数");
      return;
    }
    callback.mutate({ code, state });
    // 故意只在挂载时跑一次（callback 里 mutate 不应该重跑）
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
