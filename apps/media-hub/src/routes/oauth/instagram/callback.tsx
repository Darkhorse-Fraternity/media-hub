// apps/media-hub/src/routes/oauth/instagram/callback.tsx
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";

import { useTRPC } from "~/lib/trpc";

interface SearchParams {
  code?: string;
  state?: string;
  error?: string;
}

export const Route = createFileRoute("/oauth/instagram/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const metaError = url.searchParams.get("error");

        if (metaError) {
          return htmlResponse(
            "授权失败",
            `Meta 拒绝授权：${metaError}`,
            "error",
          );
        }
        if (!code || !state) {
          return htmlResponse("授权失败", "缺少 code 或 state 参数", "error");
        }

        try {
          console.log(
            JSON.stringify({
              level: "info",
              msg: "Instagram OAuth callback started",
              code: "IG_OAUTH_CALLBACK_STARTED",
              has_code: !!code,
              has_state: !!state,
            }),
          );
          const { completeInstagramOAuthCallback } = await import("@acme/api");
          const result = await completeInstagramOAuthCallback({ code, state });
          console.log(
            JSON.stringify({
              level: "info",
              msg: "Instagram OAuth callback completed",
              code: "IG_OAUTH_CALLBACK_COMPLETED",
              account_id: result.accountId,
              account_label: result.accountLabel,
              refreshed: result.refreshed,
            }),
          );
          return htmlResponse(
            "授权成功",
            `已绑定 Instagram 账号：${result.accountLabel}${result.refreshed ? "（已更新现有授权）" : ""}`,
            "ok",
          );
        } catch (err) {
          const raw = err instanceof Error ? err.message : String(err);
          console.error(
            JSON.stringify({
              level: "error",
              msg: "Instagram OAuth callback failed",
              code: "IG_OAUTH_CALLBACK_FAILED",
              err: raw,
            }),
          );
          const message = raw.includes("State expired")
            ? "授权链接已过期（有效期 10 分钟）。请返回 Media Hub 的平台账号页面重新授权。"
            : raw.includes("Failed to exchange OAuth code")
              ? "授权码已失效或已被使用。请返回 Media Hub 的平台账号页面重新授权。"
              : raw.includes("Meta request timed out")
                ? "连接 Meta 超时。请返回 Media Hub 的平台账号页面重新授权后再试。"
                : raw.includes("Meta did not return an Instagram")
                  ? "Meta 没有把任何 Facebook Page 返回给应用。请检查 Meta 开发者后台：企业版 Facebook 登录需要 public_profile 高级访问权，并确认授权弹窗里选中了 Pumpkii Page。"
                  : raw;
          return htmlResponse("授权失败", message, "error");
        }
      },
    },
  },
  component: InstagramOAuthCallbackPage,
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    code: typeof search.code === "string" ? search.code : undefined,
    state: typeof search.state === "string" ? search.state : undefined,
    error: typeof search.error === "string" ? search.error : undefined,
  }),
});

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function htmlResponse(
  title: string,
  message: string,
  status: "ok" | "error",
  httpStatus = 200,
): Response {
  const color = status === "ok" ? "#16a34a" : "#dc2626";
  return new Response(
    `<!doctype html>
<html lang="zh">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)} - Pumpkii Media Hub</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f8fafc; color: #0f172a; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      main { width: min(480px, calc(100vw - 32px)); padding: 32px; border-radius: 12px; background: white; box-shadow: 0 12px 30px rgba(15, 23, 42, 0.12); }
      h1 { margin: 0 0 12px; font-size: 24px; color: ${color}; }
      p { margin: 0; line-height: 1.7; color: #475569; }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(message)}</p>
    </main>
  </body>
</html>`,
    {
      status: httpStatus,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    },
  );
}

function InstagramOAuthCallbackPage() {
  const router = useRouter();
  const trpc = useTRPC();
  const { code, state, error: metaError } = Route.useSearch();

  const [status, setStatus] = useState<"running" | "ok" | "error">("running");
  const [message, setMessage] = useState<string>("正在完成 Instagram 授权…");

  const callback = useMutation(
    trpc.mediaHub.instagram.oauthCallback.mutationOptions({
      onSuccess: (data) => {
        setStatus("ok");
        setMessage(
          `已绑定 Instagram 账号：${data.accountLabel}${data.refreshed ? "（已更新现有授权）" : ""}`,
        );
        setTimeout(() => {
          void router.navigate({ to: "/" });
        }, 1200);
      },
      onError: (err) => {
        setStatus("error");
        const raw = err.message;
        const friendly = raw.includes("State expired")
          ? "授权链接已过期（有效期 10 分钟）。请返回 Media Hub 的平台账号页面重新授权。"
          : raw.includes("Meta did not return an Instagram")
            ? "Meta 没有把任何 Facebook Page 返回给应用。请检查 Meta 开发者后台：企业版 Facebook 登录需要 public_profile 高级访问权，并确认授权弹窗里选中了 Pumpkii Page。"
            : raw;
        setMessage(friendly);
      },
    }),
  );

  useEffect(() => {
    if (metaError) {
      setStatus("error");
      setMessage(`Meta 拒绝授权：${metaError}`);
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
