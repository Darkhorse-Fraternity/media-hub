import type { FormEvent, ReactNode } from "react";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import { authClient } from "~/auth/client";
import { resolutionOptions } from "~/lib/generation-resolution";
import { useTRPC } from "~/lib/trpc";

export const Route = createFileRoute("/settings")({
  component: MediaHubSettingsPage,
});

const durationOptions = [15, 30, 45, 60] as const;
const youtubeCategoryOptions = [
  { value: "22", label: "人物与博客" },
  { value: "24", label: "娱乐" },
  { value: "26", label: "操作指南与风格" },
  { value: "28", label: "科技" },
  { value: "27", label: "教育" },
  { value: "15", label: "宠物与动物" },
] as const;

interface PreferenceDraft {
  contentLanguage: "zh" | "en";
  durationSeconds: 15 | 30 | 45 | 60;
  resolution:
    | "1344x768"
    | "768x1344"
    | "960x544"
    | "544x960"
    | "768x768"
    | "1280x704"
    | "704x1280";
  youtubePrivacyStatus: "public" | "unlisted" | "private";
  youtubeCategoryId: string;
  youtubeNotifySubscribers: boolean;
  instagramShareToFeed: boolean;
  feishuWebhookUrl: string;
}

interface SystemDraft {
  h3GenerationProfile: string;
  h3EditProfile: string;
  codexWorkerUrl: string;
  codexWorkerSource: string;
  codexTimeoutMs: number;
  ollamaBaseUrl: string;
  ollamaModel: string;
}

interface H3ProfileOption {
  id: string;
  workflowVersion: string | null;
  minimumSteps: number | null;
  maxReferenceImages: number | null;
}

function h3ProfileLabel(profile: H3ProfileOption): string {
  const details = [profile.id];
  if (profile.workflowVersion) details.push(profile.workflowVersion);
  if (profile.minimumSteps && profile.minimumSteps > 1) {
    details.push(`${profile.minimumSteps} 步起`);
  }
  if (profile.maxReferenceImages === 0) details.push("仅首帧");
  return details.join(" · ");
}

function MediaHubSettingsPage() {
  const sessionQuery = authClient.useSession();

  if (sessionQuery.isPending) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-950 text-sm text-slate-400">
        正在读取设置…
      </main>
    );
  }

  if (!sessionQuery.data?.user) {
    return (
      <main className="grid min-h-screen place-items-center bg-slate-950 p-6 text-slate-100">
        <section className="max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center shadow-2xl">
          <p className="text-sm text-cyan-300">PUMPKII MEDIA HUB</p>
          <h1 className="mt-3 text-2xl font-semibold">登录后管理设置</h1>
          <p className="mt-3 text-sm leading-6 text-slate-400">
            设置与账号绑定，登录后会在不同设备间同步。
          </p>
          <Link
            to="/"
            className="mt-6 inline-flex rounded-xl bg-cyan-400 px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300"
          >
            返回登录
          </Link>
        </section>
      </main>
    );
  }

  return (
    <SettingsWorkspace
      isAdmin={sessionQuery.data.user.role === "admin"}
      userName={sessionQuery.data.user.name}
    />
  );
}

function SettingsWorkspace({
  isAdmin,
  userName,
}: {
  isAdmin: boolean;
  userName: string;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const preferencesQuery = useQuery(trpc.mediaHub.settings.me.queryOptions());
  const systemQuery = useQuery({
    ...trpc.mediaHub.settings.system.queryOptions(),
    enabled: isAdmin,
  });
  const [preferenceDraft, setPreferenceDraft] =
    useState<PreferenceDraft | null>(null);
  const [systemDraft, setSystemDraft] = useState<SystemDraft | null>(null);
  const [preferenceMessage, setPreferenceMessage] = useState<string | null>(
    null,
  );
  const [systemMessage, setSystemMessage] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Query data initializes an editable draft exactly once per response.
    if (preferencesQuery.data) setPreferenceDraft(preferencesQuery.data);
  }, [preferencesQuery.data]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Query data initializes an editable admin draft exactly once per response.
    if (systemQuery.data) setSystemDraft(systemQuery.data.values);
  }, [systemQuery.data]);

  const updatePreferences = useMutation(
    trpc.mediaHub.settings.updateMe.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({
          queryKey: trpc.mediaHub.settings.me.queryKey(),
        });
        setPreferenceMessage("个人默认值已保存，新建任务时自动使用。");
      },
      onError: (error) => setPreferenceMessage(error.message),
    }),
  );
  const updateSystem = useMutation(
    trpc.mediaHub.settings.updateSystem.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({
          queryKey: trpc.mediaHub.settings.system.queryKey(),
        });
        setSystemMessage("运行配置已更新，后续请求立即生效。");
      },
      onError: (error) => setSystemMessage(error.message),
    }),
  );

  const submitPreferences = (event: FormEvent) => {
    event.preventDefault();
    if (!preferenceDraft) return;
    setPreferenceMessage(null);
    updatePreferences.mutate(preferenceDraft);
  };

  const submitSystem = (event: FormEvent) => {
    event.preventDefault();
    if (!systemDraft) return;
    setSystemMessage(null);
    updateSystem.mutate(systemDraft);
  };

  return (
    <main className="min-h-screen bg-slate-950 p-6 text-slate-100">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-col gap-5 border-b border-slate-800 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium tracking-[0.18em] text-cyan-300">
              MEDIA HUB / CONTROL DECK
            </p>
            <h1 className="mt-2 text-3xl font-semibold">设置</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
              {userName}
              ，这里保存你的工作默认值。管理员配置是环境变量之上的在线覆盖层。
            </p>
          </div>
          <Link
            to="/"
            className="inline-flex w-fit items-center rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm text-slate-300 transition hover:border-cyan-400/50 hover:text-cyan-200 focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:outline-none"
          >
            ← 返回生成后台
          </Link>
        </header>

        <section className="grid gap-3 rounded-2xl border border-cyan-400/15 bg-cyan-400/[0.035] p-4 sm:grid-cols-4">
          <InheritanceStep label="任务参数" detail="本次手动选择" active />
          <InheritanceStep label="个人偏好" detail="跟随登录账号" active />
          <InheritanceStep
            label="管理员配置"
            detail={isAdmin ? "允许在线修改" : "由管理员维护"}
            active={isAdmin}
          />
          <InheritanceStep label="环境变量" detail="部署兜底与根密钥" />
        </section>

        <div className="grid items-start gap-6 lg:grid-cols-2">
          <form
            onSubmit={submitPreferences}
            className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-xl"
          >
            <PanelHeading
              eyebrow="个人偏好"
              title="每次创作从这里开始"
              description="只影响你的新任务，不会修改已经创建的任务。"
              badge="个人"
            />
            {!preferenceDraft ? (
              <LoadingBlock
                error={preferencesQuery.error?.message}
                label="正在读取个人偏好…"
              />
            ) : (
              <div className="space-y-6 p-6">
                <div className="grid gap-4 sm:grid-cols-2">
                  <SettingField
                    label="内容语言"
                    hint="用于对白、画面文字和发布文案；AI 优化提示词固定为英文"
                  >
                    <select
                      value={preferenceDraft.contentLanguage}
                      onChange={(event) =>
                        setPreferenceDraft({
                          ...preferenceDraft,
                          contentLanguage: event.target.value as "zh" | "en",
                        })
                      }
                      className={controlClass}
                    >
                      <option value="zh">中文</option>
                      <option value="en">English</option>
                    </select>
                  </SettingField>
                  <SettingField
                    label="视频时长"
                    hint="H3 会按 15 秒片段生成并拼接"
                  >
                    <select
                      value={preferenceDraft.durationSeconds}
                      onChange={(event) =>
                        setPreferenceDraft({
                          ...preferenceDraft,
                          durationSeconds: Number(event.target.value) as
                            | 15
                            | 30
                            | 45
                            | 60,
                        })
                      }
                      className={controlClass}
                    >
                      {durationOptions.map((seconds) => (
                        <option key={seconds} value={seconds}>
                          {seconds} 秒
                        </option>
                      ))}
                    </select>
                  </SettingField>
                  <SettingField
                    label="默认分辨率"
                    hint="横屏与竖屏都可作为个人默认值"
                  >
                    <select
                      value={preferenceDraft.resolution}
                      onChange={(event) =>
                        setPreferenceDraft({
                          ...preferenceDraft,
                          resolution: event.target
                            .value as PreferenceDraft["resolution"],
                        })
                      }
                      className={controlClass}
                    >
                      {resolutionOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </SettingField>
                  <SettingField
                    label="YouTube 可见性"
                    hint="发布前仍可在任务中覆盖"
                  >
                    <select
                      value={preferenceDraft.youtubePrivacyStatus}
                      onChange={(event) =>
                        setPreferenceDraft({
                          ...preferenceDraft,
                          youtubePrivacyStatus: event.target
                            .value as PreferenceDraft["youtubePrivacyStatus"],
                        })
                      }
                      className={controlClass}
                    >
                      <option value="public">公开</option>
                      <option value="unlisted">不公开列出</option>
                      <option value="private">私享</option>
                    </select>
                  </SettingField>
                  <SettingField
                    label="YouTube 分类"
                    hint="新发布草稿的默认分类"
                  >
                    <select
                      value={preferenceDraft.youtubeCategoryId}
                      onChange={(event) =>
                        setPreferenceDraft({
                          ...preferenceDraft,
                          youtubeCategoryId: event.target.value,
                        })
                      }
                      className={controlClass}
                    >
                      {youtubeCategoryOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </SettingField>
                </div>
                <div className="grid gap-3">
                  <ToggleSetting
                    checked={preferenceDraft.youtubeNotifySubscribers}
                    onChange={(checked) =>
                      setPreferenceDraft({
                        ...preferenceDraft,
                        youtubeNotifySubscribers: checked,
                      })
                    }
                    label="YouTube 发布时通知订阅者"
                    hint="关闭后上传视频不会主动触达订阅者。"
                  />
                  <ToggleSetting
                    checked={preferenceDraft.instagramShareToFeed}
                    onChange={(checked) =>
                      setPreferenceDraft({
                        ...preferenceDraft,
                        instagramShareToFeed: checked,
                      })
                    }
                    label="Instagram Reels 同步到动态"
                    hint="发布 Reels 时同时显示在主页动态中。"
                  />
                </div>
                <SettingField
                  label="飞书通知 Webhook"
                  hint="仅用于当前账号的生成、取消和发布结果；留空时不发送。"
                >
                  <input
                    type="url"
                    value={preferenceDraft.feishuWebhookUrl}
                    onChange={(event) =>
                      setPreferenceDraft({
                        ...preferenceDraft,
                        feishuWebhookUrl: event.target.value,
                      })
                    }
                    placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..."
                    autoComplete="off"
                    className={controlClass}
                  />
                </SettingField>
                <SaveBar
                  pending={updatePreferences.isPending}
                  message={preferenceMessage}
                  label="保存个人偏好"
                />
              </div>
            )}
          </form>

          <form
            onSubmit={submitSystem}
            className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-xl"
          >
            <PanelHeading
              eyebrow="运行配置"
              title="服务连接与通知出口"
              description="留空时继续使用部署环境变量；保存后后续请求立即读取新值。"
              badge={isAdmin ? "管理员" : "只读"}
            />
            {!isAdmin ? (
              <div className="p-6 text-sm leading-6 text-slate-400">
                当前账号可以修改个人偏好。运行配置只对管理员开放，数据库、认证密钥和对象存储始终由部署环境管理。
              </div>
            ) : !systemDraft ? (
              <LoadingBlock
                error={systemQuery.error?.message}
                label="正在读取运行配置…"
              />
            ) : (
              <div className="space-y-6 p-6">
                <div className="space-y-4">
                  <ConfigGroup label="H3 工作流">
                    <SettingField
                      label="默认生成工作流"
                      hint={`当前生效：${systemQuery.data?.effective.h3GenerationProfile ?? "未配置"}`}
                    >
                      <select
                        value={systemDraft.h3GenerationProfile}
                        onChange={(event) =>
                          setSystemDraft({
                            ...systemDraft,
                            h3GenerationProfile: event.target.value,
                          })
                        }
                        className={controlClass}
                      >
                        <option value="">跟随部署默认</option>
                        {systemQuery.data?.availableH3Profiles
                          .filter((profile) => profile.kind === "generate")
                          .map((profile) => (
                            <option key={profile.id} value={profile.id}>
                              {h3ProfileLabel(profile)}
                            </option>
                          ))}
                      </select>
                    </SettingField>
                    <SettingField
                      label="默认编辑工作流"
                      hint={`当前生效：${systemQuery.data?.effective.h3EditProfile ?? "未配置"}`}
                    >
                      <select
                        value={systemDraft.h3EditProfile}
                        onChange={(event) =>
                          setSystemDraft({
                            ...systemDraft,
                            h3EditProfile: event.target.value,
                          })
                        }
                        className={controlClass}
                      >
                        <option value="">跟随部署默认</option>
                        {systemQuery.data?.availableH3Profiles
                          .filter((profile) => profile.kind === "edit")
                          .map((profile) => (
                            <option key={profile.id} value={profile.id}>
                              {h3ProfileLabel(profile)}
                            </option>
                          ))}
                      </select>
                    </SettingField>
                    <p
                      className={`text-xs leading-5 ${
                        systemQuery.data?.h3ProviderStatus === "healthy"
                          ? "text-emerald-300"
                          : "text-amber-300"
                      }`}
                    >
                      {systemQuery.data?.h3ProviderMessage ??
                        "正在读取 H3 Provider 工作流…"}
                    </p>
                  </ConfigGroup>

                  <ConfigGroup label="Codex Worker">
                    <SettingField
                      label="服务地址"
                      hint={`当前生效：${systemQuery.data?.effective.codexWorkerUrl ?? "未配置"}`}
                    >
                      <input
                        type="url"
                        value={systemDraft.codexWorkerUrl}
                        onChange={(event) =>
                          setSystemDraft({
                            ...systemDraft,
                            codexWorkerUrl: event.target.value,
                          })
                        }
                        placeholder="留空使用 CODEX_WORKER_URL"
                        className={controlClass}
                      />
                    </SettingField>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <SettingField label="知识源" hint="默认 knowledge-bot">
                        <input
                          value={systemDraft.codexWorkerSource}
                          onChange={(event) =>
                            setSystemDraft({
                              ...systemDraft,
                              codexWorkerSource: event.target.value,
                            })
                          }
                          placeholder="knowledge-bot"
                          className={controlClass}
                        />
                      </SettingField>
                      <SettingField label="执行超时" hint="10–900 秒">
                        <input
                          type="number"
                          min={10}
                          max={900}
                          value={Math.round(systemDraft.codexTimeoutMs / 1000)}
                          onChange={(event) =>
                            setSystemDraft({
                              ...systemDraft,
                              codexTimeoutMs: Number(event.target.value) * 1000,
                            })
                          }
                          className={controlClass}
                        />
                      </SettingField>
                    </div>
                  </ConfigGroup>

                  <ConfigGroup label="日报 AI">
                    <SettingField
                      label="Ollama 地址"
                      hint={`当前生效：${systemQuery.data?.effective.ollamaBaseUrl ?? "未启用"}`}
                    >
                      <input
                        type="url"
                        value={systemDraft.ollamaBaseUrl}
                        onChange={(event) =>
                          setSystemDraft({
                            ...systemDraft,
                            ollamaBaseUrl: event.target.value,
                          })
                        }
                        placeholder="留空使用 OLLAMA_BASE_URL"
                        className={controlClass}
                      />
                    </SettingField>
                    <SettingField label="模型" hint="用于日报增长建议">
                      <input
                        value={systemDraft.ollamaModel}
                        onChange={(event) =>
                          setSystemDraft({
                            ...systemDraft,
                            ollamaModel: event.target.value,
                          })
                        }
                        placeholder="qwen3-vl:32b"
                        className={controlClass}
                      />
                    </SettingField>
                  </ConfigGroup>
                </div>
                <SaveBar
                  pending={updateSystem.isPending}
                  message={systemMessage}
                  label="保存运行配置"
                />
              </div>
            )}
          </form>
        </div>

        <section className="rounded-2xl border border-amber-400/15 bg-amber-400/[0.035] p-5">
          <p className="text-xs font-semibold tracking-[0.16em] text-amber-300">
            DEPLOYMENT BOUNDARY
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            数据库连接、认证与加密根密钥、可信来源、Cookie
            安全策略、对象存储密钥、OAuth Client Secret、FFmpeg
            路径和网络代理不会进入网页设置。
          </p>
        </section>
      </div>
    </main>
  );
}

const controlClass =
  "mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/10";

function InheritanceStep({
  label,
  detail,
  active = false,
}: {
  label: string;
  detail: string;
  active?: boolean;
}) {
  return (
    <div className="relative rounded-xl border border-slate-800 bg-slate-950/70 p-3.5">
      <span
        className={`absolute top-3 right-3 h-2 w-2 rounded-full ${active ? "bg-cyan-300 shadow-[0_0_12px_rgba(103,232,249,0.8)]" : "bg-slate-700"}`}
      />
      <p className="pr-5 text-xs font-medium text-slate-200">{label}</p>
      <p className="mt-1 text-[11px] text-slate-500">{detail}</p>
    </div>
  );
}

function PanelHeading({
  eyebrow,
  title,
  description,
  badge,
}: {
  eyebrow: string;
  title: string;
  description: string;
  badge: string;
}) {
  return (
    <div className="border-b border-slate-800 bg-slate-950/45 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium tracking-[0.14em] text-cyan-300">
            {eyebrow}
          </p>
          <h2 className="mt-2 text-lg font-semibold text-slate-100">{title}</h2>
        </div>
        <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2.5 py-1 text-[11px] text-cyan-200">
          {badge}
        </span>
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-500">{description}</p>
    </div>
  );
}

function SettingField({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <label className="block text-xs font-medium text-slate-300">
      {label}
      {children}
      <span className="mt-1.5 block leading-5 font-normal text-slate-600">
        {hint}
      </span>
    </label>
  );
}

function ToggleSetting({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-slate-800 bg-slate-950/60 p-4">
      <span>
        <span className="block text-sm text-slate-200">{label}</span>
        <span className="mt-1 block text-xs leading-5 text-slate-500">
          {hint}
        </span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 shrink-0 accent-cyan-400"
      />
    </label>
  );
}

function ConfigGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <fieldset className="space-y-4 rounded-xl border border-slate-800 bg-slate-950/45 p-4">
      <legend className="px-2 text-xs font-semibold tracking-[0.12em] text-slate-400">
        {label.toUpperCase()}
      </legend>
      {children}
    </fieldset>
  );
}

function SaveBar({
  pending,
  message,
  label,
}: {
  pending: boolean;
  message: string | null;
  label: string;
}) {
  return (
    <div className="flex flex-col gap-3 border-t border-slate-800 pt-5 sm:flex-row sm:items-center sm:justify-between">
      <p className="min-h-5 text-xs text-cyan-300">{message}</p>
      <button
        type="submit"
        disabled={pending}
        className="rounded-xl bg-cyan-400 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 focus-visible:ring-2 focus-visible:ring-cyan-200 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "保存中…" : label}
      </button>
    </div>
  );
}

function LoadingBlock({ error, label }: { error?: string; label: string }) {
  return (
    <div
      className={`p-6 text-sm ${error ? "text-rose-300" : "text-slate-500"}`}
    >
      {error ?? label}
    </div>
  );
}
