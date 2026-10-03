import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useTRPC } from "~/lib/trpc";

const agentApiEndpoints = [
  ["POST", "/api/v1/prompts/optimize", "优化 H3 视频提示词"],
  ["GET", "/api/v1/generations", "查询生成任务"],
  ["POST", "/api/v1/generations", "创建或预约视频生成任务"],
  ["GET", "/api/v1/generation-profiles", "查询可用生成工作流"],
  ["GET", "/api/v1/image-assets", "查询私有图片素材"],
  ["GET", "/api/v1/scripts", "查询视频脚本"],
  ["POST", "/api/v1/scripts", "创建结构化视频脚本"],
  ["POST", "/api/v1/scripts/draft", "根据创意简报生成脚本草稿"],
  ["POST", "/api/v1/scripts/analyze", "检查镜头时长与对白语速"],
  ["GET", "/api/v1/scripts/{scriptId}", "获取视频脚本详情"],
  ["PATCH", "/api/v1/scripts/{scriptId}", "更新视频脚本"],
  ["DELETE", "/api/v1/scripts/{scriptId}", "删除视频脚本"],
  ["POST", "/api/v1/scripts/{scriptId}/generate", "生成脚本镜头"],
  ["POST", "/api/v1/scripts/{scriptId}/assemble", "按选定版本与裁切方案合片"],
  ["POST", "/api/v1/scripts/{scriptId}/animatic", "用首帧生成低成本分镜预演"],
  [
    "GET",
    "/api/v1/scripts/{scriptId}/animatic/{version}/video",
    "读取分镜预演",
  ],
  [
    "PATCH",
    "/api/v1/scripts/{scriptId}/shots/{shotId}/take",
    "选定合片镜头版本",
  ],
  [
    "PATCH",
    "/api/v1/scripts/{scriptId}/shots/{shotId}/edit-plan",
    "设置镜头裁切与字幕",
  ],
  [
    "POST",
    "/api/v1/scripts/{scriptId}/shots/{shotId}/captions/generate",
    "从台词生成字幕草稿",
  ],
  [
    "GET",
    "/api/v1/scripts/{scriptId}/shots/{shotId}/frames",
    "查询分镜首帧候选",
  ],
  [
    "POST",
    "/api/v1/scripts/{scriptId}/shots/{shotId}/frames",
    "生成分镜首帧候选",
  ],
  [
    "PATCH",
    "/api/v1/scripts/{scriptId}/shots/{shotId}/frames/select",
    "选定或清空分镜首帧",
  ],
  [
    "POST",
    "/api/v1/scripts/{scriptId}/shots/{shotId}/carry-final-frame",
    "传递上一镜头的最后一帧",
  ],
  ["POST", "/api/v1/uploads/presign", "获取参考图上传地址"],
  ["GET", "/api/v1/generations/{jobId}", "获取生成任务"],
  ["PATCH", "/api/v1/generations/{jobId}", "更新排队中的生成任务"],
  ["DELETE", "/api/v1/generations/{jobId}", "取消或删除生成任务"],
  ["GET", "/api/v1/generations/{jobId}/video", "读取已完成的视频"],
  ["POST", "/api/v1/generations/{jobId}/edits", "创建视频修改任务"],
  ["POST", "/api/v1/generations/{jobId}/retry", "重试失败任务"],
  ["GET", "/api/v1/platform-accounts", "查询可发布的平台账号"],
  ["POST", "/api/v1/generations/{jobId}/publish", "发布已完成的视频"],
  [
    "POST",
    "/api/v1/generations/{jobId}/xiaohongshu-package",
    "准备小红书投稿包",
  ],
  ["POST", "/api/v1/generations/{jobId}/notify", "重新发送生成通知"],
] as const;

export function AgentApiManagementPanel() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(true);
  const tokenQuery = useQuery(trpc.mediaHub.apiToken.get.queryOptions());
  const resetMutation = useMutation(
    trpc.mediaHub.apiToken.reset.mutationOptions({
      onSuccess: () => {
        setShowToken(true);
        setMessage("Token 已重置，旧 Token 已立即失效。");
        void queryClient.invalidateQueries({
          queryKey: trpc.mediaHub.apiToken.get.queryKey(),
        });
      },
      onError: (error) => setMessage(error.message),
    }),
  );
  const token = tokenQuery.data?.token;

  const resetToken = () => {
    if (
      window.confirm(
        "确认重置你的 Agent API Token？当前用户的旧 Token 会立即失效。",
      )
    ) {
      setMessage(null);
      resetMutation.mutate();
    }
  };

  const copyToken = async () => {
    if (!token) return;

    try {
      let copied = false;
      const clipboard = Reflect.get(navigator, "clipboard") as
        | Clipboard
        | undefined;
      if (clipboard) {
        try {
          await clipboard.writeText(token);
          copied = true;
        } catch {
          // HTTP LAN deployments may expose the API but reject clipboard writes.
        }
      }
      if (!copied) {
        const input = document.createElement("textarea");
        input.value = token;
        input.readOnly = true;
        input.style.position = "fixed";
        input.style.left = "-9999px";
        input.style.opacity = "0";
        document.body.appendChild(input);
        input.select();
        input.setSelectionRange(0, input.value.length);
        copied = document.execCommand("copy");
        input.remove();
        if (!copied) throw new Error("Legacy clipboard copy failed");
      }
      setMessage("Token 已复制到剪贴板。");
    } catch {
      setMessage("浏览器不允许自动复制，请手动选择 Token。 ");
    }
  };

  return (
    <section className="rounded-2xl border border-violet-400/20 bg-slate-900 shadow-xl">
      <div className="border-b border-slate-800 p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-medium tracking-[0.18em] text-violet-300">
              MEDIA HUB AGENT API
            </p>
            <h2 className="mt-2 text-lg font-semibold text-slate-100">
              Agent 接口与 Token
            </h2>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-400">
              使用 Bearer Token 调用
              OpenAPI，可优化提示词、创建和管理本人视频任务、读取成品视频并发布到本人已配置平台。每位用户拥有独立
              Token，并在数据库中使用 AES-256-GCM 加密保存。
            </p>
          </div>
          <a
            href="/api/openapi"
            target="_blank"
            rel="noreferrer"
            className="shrink-0 rounded-lg border border-violet-400/30 px-3 py-2 text-xs text-violet-200 transition hover:bg-violet-400/10"
          >
            查看 OpenAPI JSON
          </a>
        </div>
      </div>
      <div className="space-y-4 p-6">
        {tokenQuery.isLoading ? (
          <p className="text-xs text-slate-500">正在读取 Token…</p>
        ) : tokenQuery.isError ? (
          <div className="space-y-3">
            <p className="text-xs text-rose-300">{tokenQuery.error.message}</p>
            {tokenQuery.error.message ===
              "API Token 解密失败，请重置 Token" && (
              <>
                <p className="text-xs leading-5 text-slate-400">
                  已保存的 Token 无法读取，已复制的旧 Token
                  仍可能可用。重置后需更新调用方使用的
                  Token；若重置仍失败，请管理员检查服务端加密密钥配置。
                </p>
                <button
                  type="button"
                  disabled={resetMutation.isPending}
                  onClick={resetToken}
                  className="rounded-lg border border-rose-400/30 px-3 py-2 text-xs text-rose-300 hover:bg-rose-400/10 disabled:opacity-45"
                >
                  {resetMutation.isPending ? "重置中…" : "重置 Token"}
                </button>
              </>
            )}
          </div>
        ) : token ? (
          <>
            <label className="block text-xs text-slate-400">
              Bearer Token
              <input
                readOnly
                type={showToken ? "text" : "password"}
                value={token}
                className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 font-mono text-xs text-slate-200 outline-none focus:border-violet-400"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setShowToken((current) => !current)}
                className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800"
              >
                {showToken ? "隐藏 Token" : "显示 Token"}
              </button>
              <button
                type="button"
                onClick={() => void copyToken()}
                className="rounded-lg border border-cyan-400/30 px-3 py-2 text-xs text-cyan-300 hover:bg-cyan-400/10"
              >
                复制 Token
              </button>
              <button
                type="button"
                disabled={resetMutation.isPending}
                onClick={resetToken}
                className="rounded-lg border border-rose-400/30 px-3 py-2 text-xs text-rose-300 hover:bg-rose-400/10 disabled:opacity-45"
              >
                {resetMutation.isPending ? "重置中…" : "重置 Token"}
              </button>
            </div>
          </>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-700 p-4">
            <p className="text-xs text-slate-400">尚未生成 Agent API Token。</p>
            <button
              type="button"
              disabled={resetMutation.isPending}
              onClick={() => resetMutation.mutate()}
              className="mt-3 rounded-lg bg-violet-400 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-violet-300 disabled:opacity-45"
            >
              {resetMutation.isPending ? "生成中…" : "生成 Token"}
            </button>
          </div>
        )}
        <div className="grid gap-3 text-xs sm:grid-cols-2">
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
            <p className="font-medium text-slate-300">鉴权方式</p>
            <code className="mt-2 block text-[11px] break-all text-cyan-300">
              Authorization: Bearer &lt;token&gt;
            </code>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
            <p className="font-medium text-slate-300">创建视频接口</p>
            <code className="mt-2 block text-[11px] text-cyan-300">
              POST /api/v1/generations
            </code>
          </div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium text-slate-300">
                OpenAPI 接口（{agentApiEndpoints.length} 个）
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                下列接口均使用上方 Bearer Token 鉴权。
              </p>
            </div>
            <a
              href="/api/openapi"
              target="_blank"
              rel="noreferrer"
              className="text-[11px] text-violet-300 underline decoration-violet-400/40 underline-offset-2 hover:text-violet-200"
            >
              查看完整 JSON
            </a>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {agentApiEndpoints.map(([method, path, description]) => (
              <div
                key={`${method}-${path}`}
                className="min-w-0 rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2"
              >
                <div className="flex items-start gap-2">
                  <span className="shrink-0 rounded bg-violet-400/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-violet-300">
                    {method}
                  </span>
                  <code className="min-w-0 font-mono text-[11px] break-all text-cyan-300">
                    {path}
                  </code>
                </div>
                <p className="mt-1 pl-12 text-[11px] text-slate-500">
                  {description}
                </p>
              </div>
            ))}
          </div>
        </div>
        {tokenQuery.data?.lastUsedAt && (
          <p className="text-[11px] text-slate-500">
            最近调用：{new Date(tokenQuery.data.lastUsedAt).toLocaleString()}
          </p>
        )}
        {message && <p className="text-xs text-cyan-300">{message}</p>}
      </div>
    </section>
  );
}
