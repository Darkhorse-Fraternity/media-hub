import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import type { ContentLanguage } from "~/lib/content-language";
import { MediaHubAccountMenu } from "~/components/media-hub-account-menu";
import { formatGenerationElapsed } from "~/lib/generation-display";
import {
  resolveScheduledAt,
  scheduleDayOptions,
  scheduleTimeOptions,
} from "~/lib/media-generation-form";
import { useTRPC } from "~/lib/trpc";

const durationOptions = [15, 30, 45, 60] as const;
type DurationSeconds = (typeof durationOptions)[number];
const qualityOptions = [
  { value: "fast", label: "快速 · 4 步", description: "预览构图和动作" },
  {
    value: "balanced",
    label: "均衡 · 6 步",
    description: "推荐，匹配 Turbo 工作流",
  },
  {
    value: "quality",
    label: "高质量 · 8 步",
    description: "细节和运动稳定性优先",
  },
] as const;
type QualityPreset = (typeof qualityOptions)[number]["value"];

const historyPageSize = 3;

const historyGenerationStatuses = ["succeeded", "failed", "canceled"] as const;

interface GenerationEditDraft {
  id: string;
  prompt: string;
  title: string;
  language: ContentLanguage;
  durationSeconds: DurationSeconds;
  qualityPreset: QualityPreset;
  scheduleDay: string;
  scheduleTime: string;
}

type PublishTiming = "now" | "scheduled";
type YouTubePrivacyStatus = "public" | "unlisted" | "private";
type DouyinPrivateStatus = 0 | 1 | 2;

interface PublishTargetDraft {
  title: string;
  description: string;
  hashtags: string;
  timing: PublishTiming;
  scheduledAt: string;
  youtubePrivacyStatus: YouTubePrivacyStatus;
  youtubeCategoryId: string;
  youtubeLanguage: string;
  youtubeMadeForKids: boolean;
  youtubeContainsSyntheticMedia: boolean;
  youtubeNotifySubscribers: boolean;
  instagramShareToFeed: boolean;
  instagramThumbOffsetSeconds: string;
  douyinPrivateStatus: DouyinPrivateStatus;
  douyinAllowDownload: boolean;
  douyinCoverTimeSeconds: string;
}

interface StoredPublishPlan {
  title: string | null;
  hashtags: string | null;
  scheduledAt: string | null;
  youtube: {
    privacyStatus: YouTubePrivacyStatus;
    categoryId: string;
    language: string;
    madeForKids: boolean;
    containsSyntheticMedia: boolean;
    notifySubscribers: boolean;
  };
  instagram: {
    shareToFeed: boolean;
    thumbOffsetMs: number | null;
  };
  douyin: {
    privateStatus: DouyinPrivateStatus;
    allowDownload: boolean;
    coverTimeSeconds: number | null;
  };
}

interface PublishPreferenceDefaults {
  youtubePrivacyStatus: YouTubePrivacyStatus;
  youtubeCategoryId: string;
  youtubeNotifySubscribers: boolean;
  instagramShareToFeed: boolean;
}

const youtubeCategoryOptions = [
  { value: "22", label: "人物与博客" },
  { value: "24", label: "娱乐" },
  { value: "26", label: "操作指南与风格" },
  { value: "28", label: "科技" },
  { value: "27", label: "教育" },
  { value: "15", label: "宠物与动物" },
] as const;

function toDateTimeLocal(value: Date | string): string {
  const date = new Date(value);
  const pad = (part: number) => part.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function defaultPublishDateTime(): string {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  date.setMinutes(Math.ceil(date.getMinutes() / 30) * 30, 0, 0);
  return toDateTimeLocal(date);
}

function createPublishTargetDraft(
  description: string | null | undefined,
  plan: StoredPublishPlan | null | undefined,
  contentLanguage: ContentLanguage,
  preferences?: PublishPreferenceDefaults,
): PublishTargetDraft {
  return {
    title: plan?.title ?? "",
    description: description ?? "",
    hashtags: plan?.hashtags ?? "",
    timing: plan?.scheduledAt ? "scheduled" : "now",
    scheduledAt: plan?.scheduledAt
      ? toDateTimeLocal(plan.scheduledAt)
      : defaultPublishDateTime(),
    youtubePrivacyStatus:
      plan?.youtube.privacyStatus ??
      preferences?.youtubePrivacyStatus ??
      "public",
    youtubeCategoryId:
      plan?.youtube.categoryId ?? preferences?.youtubeCategoryId ?? "22",
    youtubeLanguage:
      plan?.youtube.language ?? (contentLanguage === "en" ? "en" : "zh-Hans"),
    youtubeMadeForKids: plan?.youtube.madeForKids ?? false,
    youtubeContainsSyntheticMedia: plan?.youtube.containsSyntheticMedia ?? true,
    youtubeNotifySubscribers:
      plan?.youtube.notifySubscribers ??
      preferences?.youtubeNotifySubscribers ??
      true,
    instagramShareToFeed:
      plan?.instagram.shareToFeed ?? preferences?.instagramShareToFeed ?? true,
    instagramThumbOffsetSeconds:
      plan?.instagram.thumbOffsetMs === null ||
      plan?.instagram.thumbOffsetMs === undefined
        ? ""
        : String(plan.instagram.thumbOffsetMs / 1000),
    douyinPrivateStatus: plan?.douyin.privateStatus ?? 0,
    douyinAllowDownload: plan?.douyin.allowDownload ?? true,
    douyinCoverTimeSeconds:
      plan?.douyin.coverTimeSeconds === null ||
      plan?.douyin.coverTimeSeconds === undefined
        ? ""
        : String(plan.douyin.coverTimeSeconds),
  };
}

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

function resolveScheduleEditorValues(
  scheduledAt: Date | string | null,
): Pick<GenerationEditDraft, "scheduleDay" | "scheduleTime"> {
  if (!scheduledAt) return { scheduleDay: "now", scheduleTime: "09:00" };
  const target = new Date(scheduledAt);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const targetDay = new Date(target);
  targetDay.setHours(0, 0, 0, 0);
  const dayOffset = Math.max(
    0,
    Math.min(
      7,
      Math.round((targetDay.getTime() - today.getTime()) / 86_400_000),
    ),
  );
  return {
    scheduleDay: String(dayOffset),
    scheduleTime: `${target.getHours().toString().padStart(2, "0")}:${target
      .getMinutes()
      .toString()
      .padStart(2, "0")}`,
  };
}

export function VideoLibrary({
  currentUser,
  isAdmin,
  onSignOut,
}: {
  currentUser: { id: string; name: string; email: string };
  isAdmin: boolean;
  onSignOut: () => void;
}) {
  const trpc = useTRPC();

  const queryClient = useQueryClient();
  const preferencesQuery = useQuery(trpc.mediaHub.settings.me.queryOptions());

  const [message, setMessage] = useState<string | null>(null);

  const [historyPage, setHistoryPage] = useState(1);

  const [selectedPublishJobId, setSelectedPublishJobId] = useState<
    string | null
  >(null);
  const [editingJob, setEditingJob] = useState<GenerationEditDraft | null>(
    null,
  );
  const [jobActionMessages, setJobActionMessages] = useState<
    Record<string, string>
  >({});
  const [selectedAccountsByJob, setSelectedAccountsByJob] = useState<
    Record<string, string[]>
  >({});
  const [publishMessages, setPublishMessages] = useState<
    Record<string, string>
  >({});
  const [publishDraftsByJob, setPublishDraftsByJob] = useState<
    Record<string, Record<string, PublishTargetDraft>>
  >({});
  const [optimizingPromptContext, setOptimizingPromptContext] = useState<
    string | null
  >(null);
  const [optimizingCopyKey, setOptimizingCopyKey] = useState<string | null>(
    null,
  );

  const historyJobsQuery = useQuery(
    trpc.mediaHub.generation.list.queryOptions(
      {
        page: historyPage,
        pageSize: historyPageSize,
        statuses: [...historyGenerationStatuses],
        wholeVideosOnly: true,
      },
      {
        placeholderData: (previousData) => previousData,
        refetchInterval: 30_000,
      },
    ),
  );
  const accountsQuery = useQuery(trpc.mediaHub.account.list.queryOptions({}));
  const cancelMutation = useMutation(
    trpc.mediaHub.generation.cancel.mutationOptions({
      onSuccess: (_, variables) => {
        setJobActionMessages((current) => ({
          ...current,
          [variables.id]: "任务已取消，并已记录取消告警。",
        }));
        void queryClient.invalidateQueries({
          queryKey: trpc.mediaHub.generation.list.queryKey(),
        });
      },
      onError: (error, variables) => {
        setJobActionMessages((current) => ({
          ...current,
          [variables.id]: error.message,
        }));
      },
    }),
  );
  const retryMutation = useMutation(
    trpc.mediaHub.generation.retry.mutationOptions({
      onSuccess: (_, variables) => {
        setJobActionMessages((current) => ({
          ...current,
          [variables.id]: "已保留原设置并重新加入总队列。",
        }));
        void queryClient.invalidateQueries({
          queryKey: trpc.mediaHub.generation.list.queryKey(),
        });
      },
      onError: (error, variables) => {
        setJobActionMessages((current) => ({
          ...current,
          [variables.id]: error.message,
        }));
      },
    }),
  );
  const removeMutation = useMutation(
    trpc.mediaHub.generation.remove.mutationOptions({
      onSuccess: ({ storageCleanupFailed }, variables) => {
        setSelectedPublishJobId((current) =>
          current === variables.id ? null : current,
        );
        setMessage(
          storageCleanupFailed
            ? "任务已删除，但部分存储文件清理失败，已记录后台错误。"
            : "视频及任务记录已删除。",
        );
        void queryClient.invalidateQueries({
          queryKey: trpc.mediaHub.generation.list.queryKey(),
        });
      },
      onError: (error, variables) => {
        setJobActionMessages((current) => ({
          ...current,
          [variables.id]: error.message,
        }));
      },
    }),
  );
  const updateMutation = useMutation(
    trpc.mediaHub.generation.update.mutationOptions({
      onSuccess: (_, variables) => {
        setEditingJob(null);
        setJobActionMessages((current) => ({
          ...current,
          [variables.id]: "任务设置已更新。",
        }));
        void queryClient.invalidateQueries({
          queryKey: trpc.mediaHub.generation.list.queryKey(),
        });
      },
      onError: (error, variables) => {
        setJobActionMessages((current) => ({
          ...current,
          [variables.id]: error.message,
        }));
      },
    }),
  );
  const publishMutation = useMutation(
    trpc.mediaHub.generation.publish.mutationOptions({
      onSuccess: (
        { queuedCount, immediateCount, scheduledCount },
        variables,
      ) => {
        setPublishMessages((current) => ({
          ...current,
          [variables.id]:
            queuedCount > 0
              ? [
                  immediateCount > 0
                    ? `${immediateCount} 个账号已开始上传`
                    : null,
                  scheduledCount > 0
                    ? `${scheduledCount} 个账号已加入定时计划`
                    : null,
                ]
                  .filter(Boolean)
                  .join("，")
              : "所选账户已上传完成",
        }));
        void queryClient.invalidateQueries({
          queryKey: trpc.mediaHub.generation.list.queryKey(),
        });
      },
      onError: (error, variables) => {
        setPublishMessages((current) => ({
          ...current,
          [variables.id]: error.message,
        }));
      },
    }),
  );
  const xiaohongshuPackageMutation = useMutation(
    trpc.mediaHub.generation.prepareXiaohongshuPackage.mutationOptions(),
  );
  const optimizePromptMutation = useMutation(
    trpc.mediaHub.ai.optimizePrompt.mutationOptions(),
  );
  const optimizePlatformDescriptionMutation = useMutation(
    trpc.mediaHub.ai.optimizePlatformDescription.mutationOptions(),
  );

  const historyJobs = historyJobsQuery.data?.rows ?? [];
  type DetailedGenerationJob = Extract<
    (typeof historyJobs)[number],
    { isPrivate: false }
  >;
  const detailedHistoryJobs = historyJobs.filter(
    (job): job is DetailedGenerationJob => !job.isPrivate,
  );
  const historyTotal = historyJobsQuery.data?.total ?? 0;
  const historyPageCount = Math.max(
    1,
    Math.ceil(historyTotal / historyPageSize),
  );

  useEffect(() => {
    if (historyPage > historyPageCount) setHistoryPage(historyPageCount);
  }, [historyPage, historyPageCount]);
  const platformAccounts = (accountsQuery.data ?? []).filter((account) =>
    ["youtube", "instagram", "douyin"].includes(account.platform),
  );

  const beginEditingJob = (job: DetailedGenerationJob) => {
    const schedule = resolveScheduleEditorValues(job.scheduledAt);
    setJobActionMessages((current) => ({ ...current, [job.id]: "" }));
    setEditingJob({
      id: job.id,
      prompt: job.prompt,
      title: job.title ?? "",
      language: job.language === "en" ? "en" : "zh",
      durationSeconds: job.durationSeconds as DurationSeconds,
      qualityPreset: (["fast", "balanced", "quality"] as const).includes(
        job.qualityPreset as QualityPreset,
      )
        ? (job.qualityPreset as QualityPreset)
        : "balanced",
      ...schedule,
    });
  };

  const saveEditingJob = () => {
    if (!editingJob?.prompt.trim()) return;
    const scheduledAt = resolveScheduledAt(
      editingJob.scheduleDay,
      editingJob.scheduleTime,
    );
    if (scheduledAt && scheduledAt.getTime() <= Date.now()) {
      setJobActionMessages((current) => ({
        ...current,
        [editingJob.id]: "定点执行时间必须晚于当前时间",
      }));
      return;
    }
    updateMutation.mutate({
      id: editingJob.id,
      prompt: editingJob.prompt.trim(),
      language: editingJob.language,
      title: editingJob.title.trim() || null,
      durationSeconds: editingJob.durationSeconds,
      qualityPreset: editingJob.qualityPreset,
      scheduledAt,
    });
  };

  const optimizeEditingPrompt = async (job: DetailedGenerationJob) => {
    if (!editingJob?.prompt.trim()) return;
    const editingId = editingJob.id;
    setOptimizingPromptContext(editingId);
    setJobActionMessages((current) => ({
      ...current,
      [editingId]: "AI 正在优化提示词…",
    }));
    try {
      const result = await optimizePromptMutation.mutateAsync({
        prompt: editingJob.prompt.trim(),
        language: editingJob.language,
        title: editingJob.title.trim() || undefined,
        durationSeconds: editingJob.durationSeconds,
        hasReferenceImage:
          Boolean(job.sourceImageStorageKey) || job.referenceImages.length > 0,
      });
      setEditingJob((current) =>
        current?.id === editingId
          ? { ...current, prompt: result.text }
          : current,
      );
      setJobActionMessages((current) => ({
        ...current,
        [editingId]: "提示词已优化，保存后生效。",
      }));
    } catch (error) {
      setJobActionMessages((current) => ({
        ...current,
        [editingId]: error instanceof Error ? error.message : "提示词优化失败",
      }));
    } finally {
      setOptimizingPromptContext(null);
    }
  };

  const confirmCancelJob = (job: DetailedGenerationJob) => {
    const trimmedTitle = job.title?.trim();
    const label =
      trimmedTitle && trimmedTitle.length > 0
        ? trimmedTitle
        : job.prompt.slice(0, 60);
    const confirmed = window.confirm(
      `⚠️ 确定取消“${label}”吗？\n\n取消后不可恢复，并会记录审计日志和发送取消告警。`,
    );
    if (!confirmed) return;
    setJobActionMessages((current) => ({
      ...current,
      [job.id]: "正在取消任务…",
    }));
    cancelMutation.mutate({ id: job.id });
  };

  const confirmRemoveJob = (job: DetailedGenerationJob) => {
    const trimmedTitle = job.title?.trim();
    const label =
      trimmedTitle && trimmedTitle.length > 0
        ? trimmedTitle
        : job.prompt.slice(0, 60);
    const confirmed = window.confirm(
      `⚠️ 永久删除“${label}”的本地记录吗？\n\nMedia Hub 中的视频文件、参考图片、任务和发布记录都会被删除，且无法恢复。已经发布到平台的内容会继续保留，不会从 YouTube、Instagram 或抖音删除。`,
    );
    if (!confirmed) return;
    setJobActionMessages((current) => ({
      ...current,
      [job.id]: "正在删除视频…",
    }));
    removeMutation.mutate({ id: job.id });
  };

  const toggleAccount = (
    jobId: string,
    accountId: string,
    fallbackAccountIds: string[],
  ) => {
    setSelectedAccountsByJob((current) => {
      const selected = current[jobId] ?? fallbackAccountIds;
      return {
        ...current,
        [jobId]: selected.includes(accountId)
          ? selected.filter((id) => id !== accountId)
          : [...selected, accountId],
      };
    });
  };

  const updatePublishDraft = (
    jobId: string,
    accountId: string,
    fallback: PublishTargetDraft,
    patch: Partial<PublishTargetDraft>,
  ) => {
    setPublishDraftsByJob((current) => {
      const currentJob = current[jobId] ?? {};
      return {
        ...current,
        [jobId]: {
          ...currentJob,
          [accountId]: {
            ...(currentJob[accountId] ?? fallback),
            ...patch,
          },
        },
      };
    });
  };

  const optimizePlatformDescription = async ({
    job,
    account,
    currentDescription,
    fallbackDraft,
  }: {
    job: DetailedGenerationJob;
    account: (typeof platformAccounts)[number];
    currentDescription: string;
    fallbackDraft: PublishTargetDraft;
  }) => {
    const key = `${job.id}:${account.id}`;
    setOptimizingCopyKey(key);
    setPublishMessages((current) => ({
      ...current,
      [job.id]: `AI 正在${currentDescription.trim() ? "优化" : "生成"} ${account.platform} 文案…`,
    }));
    try {
      const result = await optimizePlatformDescriptionMutation.mutateAsync({
        jobId: job.id,
        accountId: account.id,
        currentDescription: currentDescription.trim()
          ? currentDescription.trim()
          : undefined,
      });
      updatePublishDraft(job.id, account.id, fallbackDraft, {
        description: result.text,
      });
      setPublishMessages((current) => ({
        ...current,
        [job.id]: `${account.platform} 文案已生成，可以继续编辑。`,
      }));
    } catch (error) {
      setPublishMessages((current) => ({
        ...current,
        [job.id]: error instanceof Error ? error.message : "平台文案生成失败",
      }));
    } finally {
      setOptimizingCopyKey(null);
    }
  };

  return (
    <main className="min-h-dvh bg-slate-950 p-4 text-slate-100 sm:p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-800 pb-5">
          <div>
            <h1 className="text-3xl font-semibold text-balance">作品库</h1>
            <p className="mt-2 text-sm text-pretty text-slate-400">
              查看已生成的视频，下载、修改或发布到平台。
            </p>
            <Link
              to="/"
              className="mt-4 inline-flex border border-slate-700 px-4 py-2 text-sm text-slate-300"
            >
              返回导演台
            </Link>
          </div>
          <MediaHubAccountMenu
            user={currentUser}
            isAdmin={isAdmin}
            onSignedOut={onSignOut}
          />
        </header>
        {message && (
          <p role="status" className="text-sm text-cyan-300">
            {message}
          </p>
        )}

        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <h2 className="text-lg font-semibold">历史生成</h2>
            <span className="text-xs text-slate-500">
              {historyTotal} 条历史记录 · 每页 {historyPageSize} 条 · 30 秒刷新
            </span>
          </div>
          {historyJobsQuery.isLoading ? (
            <div className="rounded-xl border border-dashed border-slate-700 px-4 py-12 text-center text-sm text-slate-500">
              正在读取历史记录…
            </div>
          ) : detailedHistoryJobs.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-700 px-4 py-12 text-center text-sm text-slate-500">
              暂无历史生成记录
            </div>
          ) : (
            <div className="space-y-3">
              {detailedHistoryJobs.map((job) => {
                const fallbackAccountIds = job.publishTargets
                  .filter((target) =>
                    ["pending", "failed"].includes(target.status),
                  )
                  .map((target) => target.accountId);
                const selectedAccountIds =
                  selectedAccountsByJob[job.id] ?? fallbackAccountIds;
                const isPublishingThisJob =
                  publishMutation.isPending &&
                  publishMutation.variables.id === job.id;
                const hasActivePublish = job.publishTargets.some(
                  (target) => target.status === "publishing",
                );
                const currentEdit =
                  editingJob?.id === job.id ? editingJob : null;
                const isEditing = currentEdit !== null;
                const canEdit = ["scheduled", "queued"].includes(job.status);
                const canCancel = [
                  "scheduled",
                  "queued",
                  "waiting_for_gpu",
                  "running",
                ].includes(job.status);
                const isTerminalJob = [
                  "succeeded",
                  "failed",
                  "canceled",
                ].includes(job.status);
                const canRemove = job.canRemove;
                const canRetry = job.canRetry;
                const removeDisabledReason = !canRemove
                  ? "视频正在上传，不能删除"
                  : undefined;
                const isUpdatingThisJob =
                  updateMutation.isPending &&
                  updateMutation.variables.id === job.id;
                const isCancelingThisJob =
                  cancelMutation.isPending &&
                  cancelMutation.variables.id === job.id;
                const isRetryingThisJob =
                  retryMutation.isPending &&
                  retryMutation.variables.id === job.id;
                const isRemovingThisJob =
                  removeMutation.isPending &&
                  removeMutation.variables.id === job.id;
                const isSelectedForPublishing = selectedPublishJobId === job.id;
                const trimmedJobTitle = job.title?.trim();
                const jobLabel =
                  trimmedJobTitle && trimmedJobTitle.length > 0
                    ? trimmedJobTitle
                    : job.prompt;
                const generationKindLabel =
                  job.kind === "assemble"
                    ? "完整成片"
                    : job.kind === "edit"
                      ? "Ref2VA 修改"
                      : "H3 生成";
                const selectedPublishDrafts = selectedAccountIds.map(
                  (accountId) => {
                    const target = job.publishTargets.find(
                      (item) => item.accountId === accountId,
                    );
                    return (
                      publishDraftsByJob[job.id]?.[accountId] ??
                      createPublishTargetDraft(
                        target?.description,
                        target?.publishPlan as
                          | StoredPublishPlan
                          | null
                          | undefined,
                        job.language === "en" ? "en" : "zh",
                        preferencesQuery.data,
                      )
                    );
                  },
                );
                const selectedScheduledCount = selectedPublishDrafts.filter(
                  (draft) => draft.timing === "scheduled",
                ).length;
                const generationElapsed = formatGenerationElapsed(
                  job.startedAt,
                  job.finishedAt,
                );
                const failedPublishTargets = job.publishTargets.filter(
                  (target) => target.status === "failed",
                );

                return (
                  <article
                    key={job.id}
                    id={`generation-job-${job.id}`}
                    className={`rounded-xl border bg-slate-950/70 p-4 transition ${
                      isSelectedForPublishing
                        ? "border-cyan-400/50 shadow-[0_0_0_1px_rgba(34,211,238,0.08)]"
                        : "border-slate-800"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {jobLabel}
                        </p>
                        {trimmedJobTitle && (
                          <p className="mt-1 line-clamp-2 text-xs text-slate-400">
                            {job.prompt}
                          </p>
                        )}
                        <p className="mt-1 text-xs text-slate-500">
                          {job.scheduledAt
                            ? `定于 ${new Date(job.scheduledAt).toLocaleString()}`
                            : new Date(job.createdAt).toLocaleString()}
                          {` · ${generationKindLabel}`}
                          {` · 视频 ${job.durationSeconds} 秒`}
                          {job.kind === "assemble"
                            ? ` · ${job.providerJobIds.length} 个镜头`
                            : ` · ${job.steps} 步`}
                          {job.kind === "generate" &&
                            ` · ${qualityOptions.find((option) => option.value === job.qualityPreset)?.label.split(" · ")[0] ?? job.qualityPreset}`}
                          {` · ${job.language === "en" ? "English" : "中文"}`}
                          {(job.sourceImageStorageKey
                            ? true
                            : job.referenceImages.length > 0) &&
                            ` · 参考图 ${job.referenceImages.length + (job.sourceImageStorageKey ? 1 : 0)} 张`}
                        </p>
                        {generationElapsed && (
                          <p className="mt-1 text-xs text-cyan-300/80">
                            {job.status === "running"
                              ? "已生成"
                              : job.status === "succeeded"
                                ? "生成耗时"
                                : "执行耗时"}
                            ：{generationElapsed}
                          </p>
                        )}
                        {job.audioValidationStatus && (
                          <p
                            className={`mt-1 text-xs ${
                              job.audioValidationStatus === "verified"
                                ? "text-emerald-300/80"
                                : job.audioValidationStatus === "mismatch"
                                  ? "text-rose-300/80"
                                  : "text-amber-300/80"
                            }`}
                          >
                            原声对白验收：
                            {job.audioValidationStatus === "verified"
                              ? `已验证${job.asrMatchPercent === null ? "" : ` · 匹配度 ${job.asrMatchPercent}%`}`
                              : job.audioValidationStatus === "mismatch"
                                ? "不匹配 · 已保留原片"
                                : "未验证 · 已保留原片"}
                          </p>
                        )}
                        <p className="mt-1 text-[11px] text-slate-600">
                          创建人：
                          {job.creator
                            ? `${job.creator.name} · ${job.creator.email}`
                            : job.createdBy}
                        </p>
                        <p className="mt-1 font-mono text-[10px] break-all text-slate-700">
                          {job.width}×{job.height} · seed {job.seed ?? "—"} ·{" "}
                          {job.modelVersion ?? job.profile}
                          {job.workflowVersion
                            ? ` · ${job.workflowVersion}`
                            : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2">
                        <StatusBadge status={job.status} />
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          {canRetry && (
                            <button
                              type="button"
                              disabled={isRetryingThisJob}
                              onClick={() =>
                                retryMutation.mutate({ id: job.id })
                              }
                              className="rounded-lg border border-amber-300/40 bg-amber-300/5 px-2.5 py-1.5 text-xs font-medium text-amber-200 transition hover:bg-amber-300/10 hover:text-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {isRetryingThisJob ? "正在重试…" : "重试生成"}
                            </button>
                          )}
                          {job.status === "succeeded" && (
                            <details className="group relative">
                              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg border border-slate-600 bg-slate-800/60 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition hover:border-cyan-400/40 hover:text-white focus-visible:ring-2 focus-visible:ring-cyan-300/30 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
                                视频操作
                                <span
                                  aria-hidden="true"
                                  className="text-[10px] text-slate-400 transition-transform group-open:rotate-180"
                                >
                                  ▾
                                </span>
                              </summary>
                              <div className="absolute top-[calc(100%+0.4rem)] right-0 z-30 min-w-36 overflow-hidden rounded-xl border border-slate-700 bg-slate-950 p-1.5 shadow-[0_18px_48px_rgba(2,8,23,0.72)]">
                                <a
                                  href={`/api/media-hub/generation/${encodeURIComponent(job.id)}/video?download=1`}
                                  download
                                  onClick={(event) =>
                                    event.currentTarget
                                      .closest("details")
                                      ?.removeAttribute("open")
                                  }
                                  className="block rounded-lg px-3 py-2 text-left text-xs text-slate-200 transition hover:bg-slate-800 hover:text-white"
                                >
                                  下载视频
                                </a>
                                <button
                                  type="button"
                                  disabled={
                                    xiaohongshuPackageMutation.isPending
                                  }
                                  onClick={async (event) => {
                                    event.currentTarget
                                      .closest("details")
                                      ?.removeAttribute("open");
                                    setJobActionMessages((current) => ({
                                      ...current,
                                      [job.id]: "正在准备小红书投稿文案…",
                                    }));
                                    try {
                                      const publishPackage =
                                        await xiaohongshuPackageMutation.mutateAsync(
                                          {
                                            id: job.id,
                                          },
                                        );
                                      await navigator.clipboard.writeText(
                                        publishPackage.caption,
                                      );
                                      setJobActionMessages((current) => ({
                                        ...current,
                                        [job.id]:
                                          "小红书文案已复制。请下载视频，并在小红书 App 内确认发布。",
                                      }));
                                    } catch (error) {
                                      setJobActionMessages((current) => ({
                                        ...current,
                                        [job.id]:
                                          error instanceof Error
                                            ? error.message
                                            : "小红书投稿包准备失败",
                                      }));
                                    }
                                  }}
                                  className="block w-full rounded-lg px-3 py-2 text-left text-xs text-rose-200 transition hover:bg-rose-400/10 hover:text-rose-100 disabled:opacity-45"
                                >
                                  {xiaohongshuPackageMutation.isPending
                                    ? "正在准备…"
                                    : "复制小红书投稿文案"}
                                </button>
                                <Link
                                  to="/generations/$jobId/edit"
                                  params={{ jobId: job.id }}
                                  onClick={(event) =>
                                    event.currentTarget
                                      .closest("details")
                                      ?.removeAttribute("open")
                                  }
                                  className="block rounded-lg px-3 py-2 text-left text-xs text-violet-200 transition hover:bg-violet-400/10 hover:text-violet-100"
                                >
                                  修改此视频
                                </Link>
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.currentTarget
                                      .closest("details")
                                      ?.removeAttribute("open");
                                    if (isSelectedForPublishing) {
                                      setSelectedPublishJobId(null);
                                      return;
                                    }
                                    setSelectedPublishJobId(job.id);
                                  }}
                                  className={`block w-full rounded-lg px-3 py-2 text-left text-xs transition ${
                                    isSelectedForPublishing
                                      ? "bg-cyan-300/10 text-cyan-200"
                                      : "text-cyan-300 hover:bg-cyan-400/10 hover:text-cyan-200"
                                  }`}
                                >
                                  {isSelectedForPublishing
                                    ? "收起发布"
                                    : "选择此视频"}
                                </button>
                                <div className="my-1 border-t border-slate-800" />
                                <button
                                  type="button"
                                  title={removeDisabledReason}
                                  disabled={!canRemove || isRemovingThisJob}
                                  onClick={(event) => {
                                    event.currentTarget
                                      .closest("details")
                                      ?.removeAttribute("open");
                                    confirmRemoveJob(job);
                                  }}
                                  className="block w-full rounded-lg px-3 py-2 text-left text-xs text-rose-300 transition hover:bg-rose-400/10 hover:text-rose-200 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {isRemovingThisJob
                                    ? "正在删除…"
                                    : removeDisabledReason
                                      ? "不可删除"
                                      : "删除视频"}
                                </button>
                              </div>
                            </details>
                          )}
                          {isTerminalJob && job.status !== "succeeded" && (
                            <>
                              {job.status === "failed" && (
                                <button
                                  type="button"
                                  disabled={isRetryingThisJob}
                                  onClick={() =>
                                    retryMutation.mutate({ id: job.id })
                                  }
                                  className="rounded-lg border border-amber-300/30 bg-amber-300/5 px-2.5 py-1.5 text-xs font-medium text-amber-200 transition hover:bg-amber-300/10 disabled:opacity-50"
                                >
                                  {isRetryingThisJob ? "正在重试…" : "重试任务"}
                                </button>
                              )}
                              <button
                                type="button"
                                title={removeDisabledReason}
                                disabled={!canRemove || isRemovingThisJob}
                                onClick={() => confirmRemoveJob(job)}
                                className="rounded-lg border border-rose-400/30 bg-rose-400/5 px-2.5 py-1.5 text-xs font-medium text-rose-300 transition hover:bg-rose-400/10 hover:text-rose-200 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {isRemovingThisJob
                                  ? "正在删除…"
                                  : removeDisabledReason
                                    ? "不可删除"
                                    : "删除记录"}
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    {(canEdit || canCancel) && !isEditing && (
                      <div className="mt-3 flex items-center gap-3 border-t border-slate-800 pt-3">
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => beginEditingJob(job)}
                            className="text-xs text-cyan-300 underline hover:text-cyan-200"
                          >
                            修改任务
                          </button>
                        )}
                        {canCancel && (
                          <button
                            type="button"
                            disabled={isCancelingThisJob}
                            onClick={() => confirmCancelJob(job)}
                            className="text-xs text-rose-300 underline hover:text-rose-200 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {isCancelingThisJob ? "正在取消…" : "取消任务"}
                          </button>
                        )}
                      </div>
                    )}
                    {currentEdit && (
                      <div className="mt-3 space-y-3 rounded-xl border border-cyan-400/20 bg-slate-900/80 p-3">
                        <div>
                          <div className="flex items-center justify-between gap-3">
                            <label
                              htmlFor={`edit-prompt-${job.id}`}
                              className="text-xs text-slate-400"
                            >
                              视频描述 / 动作提示词
                            </label>
                            <button
                              type="button"
                              disabled={
                                !currentEdit.prompt.trim() ||
                                optimizingPromptContext !== null
                              }
                              onClick={() => void optimizeEditingPrompt(job)}
                              className="rounded-md border border-violet-400/30 px-2.5 py-1 text-[11px] text-violet-200 transition hover:bg-violet-400/10 disabled:cursor-not-allowed disabled:opacity-45"
                            >
                              {optimizingPromptContext === job.id
                                ? "AI 优化中…"
                                : "✦ AI 优化"}
                            </button>
                          </div>
                          <textarea
                            id={`edit-prompt-${job.id}`}
                            value={currentEdit.prompt}
                            rows={4}
                            onChange={(event) =>
                              setEditingJob((current) =>
                                current?.id === job.id
                                  ? {
                                      ...current,
                                      prompt: event.target.value,
                                    }
                                  : current,
                              )
                            }
                            className="mt-1.5 w-full resize-y rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 outline-none focus:border-cyan-400"
                          />
                        </div>
                        <div className="grid gap-3 sm:grid-cols-3">
                          <label className="block text-xs text-slate-400">
                            任务名称
                            <input
                              value={currentEdit.title}
                              onChange={(event) =>
                                setEditingJob((current) =>
                                  current?.id === job.id
                                    ? {
                                        ...current,
                                        title: event.target.value,
                                      }
                                    : current,
                                )
                              }
                              className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 outline-none focus:border-cyan-400"
                            />
                          </label>
                          <label className="block text-xs text-slate-400">
                            视频时长
                            <select
                              value={currentEdit.durationSeconds}
                              onChange={(event) =>
                                setEditingJob((current) =>
                                  current?.id === job.id
                                    ? {
                                        ...current,
                                        durationSeconds: Number(
                                          event.target.value,
                                        ) as DurationSeconds,
                                      }
                                    : current,
                                )
                              }
                              className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 outline-none focus:border-cyan-400"
                            >
                              {durationOptions.map((seconds) => (
                                <option key={seconds} value={seconds}>
                                  {seconds} 秒
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="block text-xs text-slate-400">
                            内容语言
                            <select
                              value={currentEdit.language}
                              onChange={(event) =>
                                setEditingJob((current) =>
                                  current?.id === job.id
                                    ? {
                                        ...current,
                                        language: event.target
                                          .value as ContentLanguage,
                                      }
                                    : current,
                                )
                              }
                              className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 outline-none focus:border-cyan-400"
                            >
                              <option value="zh">中文</option>
                              <option value="en">English</option>
                            </select>
                          </label>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <label className="block text-xs text-slate-400">
                            执行日期
                            <select
                              value={currentEdit.scheduleDay}
                              onChange={(event) =>
                                setEditingJob((current) =>
                                  current?.id === job.id
                                    ? {
                                        ...current,
                                        scheduleDay: event.target.value,
                                      }
                                    : current,
                                )
                              }
                              className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 outline-none focus:border-cyan-400"
                            >
                              {scheduleDayOptions.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="block text-xs text-slate-400">
                            执行时间
                            <select
                              value={currentEdit.scheduleTime}
                              disabled={currentEdit.scheduleDay === "now"}
                              onChange={(event) =>
                                setEditingJob((current) =>
                                  current?.id === job.id
                                    ? {
                                        ...current,
                                        scheduleTime: event.target.value,
                                      }
                                    : current,
                                )
                              }
                              className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 outline-none focus:border-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {scheduleTimeOptions.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setEditingJob(null)}
                            className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:border-slate-600"
                          >
                            放弃修改
                          </button>
                          <button
                            type="button"
                            disabled={
                              isUpdatingThisJob || !currentEdit.prompt.trim()
                            }
                            onClick={saveEditingJob}
                            className="rounded-lg bg-cyan-400 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {isUpdatingThisJob ? "保存中…" : "保存修改"}
                          </button>
                        </div>
                      </div>
                    )}
                    {job.errorMessage && (
                      <div className="mt-3 rounded-lg border border-rose-400/25 bg-rose-400/5 px-3 py-2.5 text-xs text-rose-200">
                        <p>{job.errorMessage}</p>
                        {(job.errorCode ?? job.failureStage) && (
                          <p className="mt-1 font-mono text-[10px] text-rose-300/70">
                            {job.errorCode ?? "unknown"} ·{" "}
                            {job.failureStage ?? "unknown"}
                            {job.errorRetryable === null
                              ? ""
                              : ` · ${job.errorRetryable ? "可重试" : "不可重试"}`}
                          </p>
                        )}
                      </div>
                    )}
                    {job.status === "failed" && job.outputStorageKey && (
                      <a
                        href={`/api/media-hub/generation/${encodeURIComponent(job.id)}/video?download=1`}
                        download
                        className="mt-3 inline-flex rounded-lg border border-amber-300/40 px-3 py-2 text-xs font-medium text-amber-200 hover:bg-amber-300/10"
                      >
                        下载已保留原片
                      </a>
                    )}
                    {failedPublishTargets.length > 0 && (
                      <div
                        role="alert"
                        className="mt-3 rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2.5 text-xs text-rose-200"
                      >
                        <p className="font-semibold text-rose-300">
                          平台上传失败
                        </p>
                        <div className="mt-1 space-y-1">
                          {failedPublishTargets.map((target) => (
                            <p key={target.id} className="break-words">
                              {target.accountLabel}：
                              {target.errorMessage ?? "上传失败，请重试"}
                            </p>
                          ))}
                        </div>
                      </div>
                    )}
                    {job.mediaTaskId && (
                      <p className="mt-3 text-xs text-emerald-300">
                        已生成媒体草稿：{job.mediaTaskId}
                      </p>
                    )}
                    {job.status === "succeeded" && !isSelectedForPublishing && (
                      <GeneratedVideoThumbnail
                        jobId={job.id}
                        title={jobLabel}
                        onSelect={() => setSelectedPublishJobId(job.id)}
                      />
                    )}
                    {job.status === "succeeded" && isSelectedForPublishing && (
                      <div className="mt-4 border-t border-slate-800 pt-4">
                        <GeneratedVideoPlayer jobId={job.id} title={jobLabel} />
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-slate-200">
                              上传到平台
                            </p>
                            <div className="mt-2 rounded-lg border border-cyan-400/20 bg-cyan-400/5 px-3 py-2">
                              <p className="text-[10px] font-semibold tracking-[0.14em] text-cyan-400 uppercase">
                                本次发布视频
                              </p>
                              <p className="mt-1 line-clamp-2 text-xs text-cyan-100">
                                {jobLabel}
                              </p>
                              <p className="mt-1 font-mono text-[10px] text-slate-500">
                                {job.id}
                              </p>
                            </div>
                            <p className="mt-2 text-xs text-slate-500">
                              每个账号可单独设置文案、发布时间和平台参数；确认后按计划执行。
                            </p>
                          </div>
                        </div>

                        {accountsQuery.isLoading ? (
                          <p className="mt-3 text-xs text-slate-500">
                            正在读取已绑定账户…
                          </p>
                        ) : platformAccounts.length === 0 ? (
                          <p className="mt-3 rounded-lg border border-dashed border-slate-700 px-3 py-4 text-center text-xs text-slate-500">
                            暂无已绑定的 YouTube、Instagram 或抖音账户。
                          </p>
                        ) : (
                          <div className="mt-3 space-y-2">
                            {platformAccounts.map((account) => {
                              const target = job.publishTargets.find(
                                (item) => item.accountId === account.id,
                              );
                              const isLocked = [
                                "publishing",
                                "published",
                              ].includes(target?.status ?? "");
                              const isChecked =
                                isLocked ||
                                selectedAccountIds.includes(account.id);
                              const fallbackDraft = createPublishTargetDraft(
                                target?.description,
                                target?.publishPlan as
                                  | StoredPublishPlan
                                  | null
                                  | undefined,
                                job.language === "en" ? "en" : "zh",
                                preferencesQuery.data,
                              );
                              const publishDraft =
                                publishDraftsByJob[job.id]?.[account.id] ??
                                fallbackDraft;
                              const platformDescription =
                                publishDraft.description;
                              const copyKey = `${job.id}:${account.id}`;
                              return (
                                <div
                                  key={account.id}
                                  className={`rounded-xl border transition ${
                                    isChecked
                                      ? "border-cyan-400/40 bg-cyan-400/5"
                                      : "border-slate-800 bg-slate-900/60 hover:border-slate-700"
                                  }`}
                                >
                                  <label
                                    className={`flex items-center gap-3 px-3 py-2.5 ${isLocked ? "cursor-default" : "cursor-pointer"}`}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={isChecked}
                                      disabled={isLocked}
                                      onChange={() =>
                                        toggleAccount(
                                          job.id,
                                          account.id,
                                          fallbackAccountIds,
                                        )
                                      }
                                      className="size-4 rounded border-slate-600 bg-slate-950 accent-cyan-400"
                                    />
                                    <span
                                      className={`rounded-md px-2 py-1 text-[10px] font-semibold tracking-wide uppercase ${platformBadgeClass(account.platform)}`}
                                    >
                                      {platformDisplayName(account.platform)}
                                    </span>
                                    <span className="min-w-0 flex-1 truncate text-xs text-slate-200">
                                      {account.accountLabel}
                                    </span>
                                    {target && (
                                      <PublishTargetBadge
                                        status={target.status}
                                        externalUrl={target.externalUrl}
                                        errorMessage={target.errorMessage}
                                        scheduledAt={
                                          target.publishPlan?.scheduledAt
                                        }
                                      />
                                    )}
                                  </label>
                                  {isChecked && (
                                    <div className="border-t border-slate-800/80 px-3 py-3">
                                      <div className="grid gap-3 sm:grid-cols-2">
                                        <label className="text-[11px] font-medium text-slate-400">
                                          发布标题
                                          <input
                                            value={publishDraft.title}
                                            disabled={isLocked}
                                            maxLength={
                                              account.platform === "youtube"
                                                ? 100
                                                : 200
                                            }
                                            onChange={(event) =>
                                              updatePublishDraft(
                                                job.id,
                                                account.id,
                                                fallbackDraft,
                                                {
                                                  title: event.target.value,
                                                },
                                              )
                                            }
                                            placeholder={jobLabel}
                                            className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-slate-200 transition outline-none placeholder:text-slate-600 focus:border-cyan-400 disabled:opacity-60"
                                          />
                                        </label>
                                        <label className="text-[11px] font-medium text-slate-400">
                                          标签
                                          <input
                                            value={publishDraft.hashtags}
                                            disabled={isLocked}
                                            maxLength={500}
                                            onChange={(event) =>
                                              updatePublishDraft(
                                                job.id,
                                                account.id,
                                                fallbackDraft,
                                                {
                                                  hashtags: event.target.value,
                                                },
                                              )
                                            }
                                            placeholder="#pumpkii #AIvideo"
                                            className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-slate-200 transition outline-none placeholder:text-slate-600 focus:border-cyan-400 disabled:opacity-60"
                                          />
                                        </label>
                                      </div>
                                      <div className="mt-3 flex items-center justify-between gap-3">
                                        <label
                                          htmlFor={`platform-copy-${copyKey}`}
                                          className="text-[11px] font-medium text-slate-400"
                                        >
                                          发布文案
                                        </label>
                                        {!isLocked && (
                                          <button
                                            type="button"
                                            disabled={
                                              optimizingCopyKey !== null
                                            }
                                            onClick={() =>
                                              void optimizePlatformDescription({
                                                job,
                                                account,
                                                currentDescription:
                                                  platformDescription,
                                                fallbackDraft,
                                              })
                                            }
                                            className="rounded-md border border-violet-400/30 bg-violet-400/5 px-2.5 py-1 text-[11px] font-medium text-violet-200 transition hover:bg-violet-400/10 disabled:cursor-not-allowed disabled:opacity-45"
                                          >
                                            {optimizingCopyKey === copyKey
                                              ? "AI 处理中…"
                                              : platformDescription.trim()
                                                ? `✦ AI 优化${job.language === "en" ? "英文" : "中文"}文案`
                                                : `✦ AI 生成${job.language === "en" ? "英文" : "中文"}文案`}
                                          </button>
                                        )}
                                      </div>
                                      <textarea
                                        id={`platform-copy-${copyKey}`}
                                        rows={4}
                                        maxLength={
                                          account.platform === "instagram"
                                            ? 2200
                                            : account.platform === "douyin"
                                              ? 1000
                                              : 5000
                                        }
                                        disabled={isLocked}
                                        value={platformDescription}
                                        onChange={(event) =>
                                          updatePublishDraft(
                                            job.id,
                                            account.id,
                                            fallbackDraft,
                                            {
                                              description: event.target.value,
                                            },
                                          )
                                        }
                                        placeholder={`填写该平台使用的${job.language === "en" ? "英文" : "中文"}描述；也可以点击 AI 生成。`}
                                        className="mt-2 w-full resize-y rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs leading-5 text-slate-200 transition outline-none focus:border-violet-400 disabled:cursor-not-allowed disabled:opacity-60"
                                      />
                                      <p className="mt-1 text-right text-[10px] text-slate-600">
                                        {platformDescription.length} /{" "}
                                        {account.platform === "instagram"
                                          ? 2200
                                          : account.platform === "douyin"
                                            ? 1000
                                            : 5000}
                                      </p>

                                      <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                                        <p className="text-[10px] font-semibold tracking-[0.14em] text-slate-500 uppercase">
                                          发布时间
                                        </p>
                                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                                          <select
                                            aria-label="发布时间类型"
                                            value={publishDraft.timing}
                                            disabled={isLocked}
                                            onChange={(event) =>
                                              updatePublishDraft(
                                                job.id,
                                                account.id,
                                                fallbackDraft,
                                                {
                                                  timing: event.target
                                                    .value as PublishTiming,
                                                },
                                              )
                                            }
                                            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 outline-none focus:border-cyan-400 disabled:opacity-60"
                                          >
                                            <option value="now">
                                              立即发布
                                            </option>
                                            <option value="scheduled">
                                              定时发布
                                            </option>
                                          </select>
                                          <input
                                            type="datetime-local"
                                            aria-label="定时发布时间"
                                            value={publishDraft.scheduledAt}
                                            min={toDateTimeLocal(new Date())}
                                            disabled={
                                              isLocked ||
                                              publishDraft.timing === "now"
                                            }
                                            onChange={(event) =>
                                              updatePublishDraft(
                                                job.id,
                                                account.id,
                                                fallbackDraft,
                                                {
                                                  scheduledAt:
                                                    event.target.value,
                                                },
                                              )
                                            }
                                            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 outline-none focus:border-cyan-400 disabled:cursor-not-allowed disabled:opacity-40"
                                          />
                                        </div>
                                      </div>

                                      {account.platform === "youtube" ? (
                                        <div className="mt-3 rounded-lg border border-red-400/15 bg-red-400/[0.03] p-3">
                                          <p className="text-[10px] font-semibold tracking-[0.14em] text-red-300/80 uppercase">
                                            YouTube 设置
                                          </p>
                                          <div className="mt-2 grid gap-2 sm:grid-cols-3">
                                            <label className="text-[10px] text-slate-500">
                                              可见范围
                                              <select
                                                value={
                                                  publishDraft.youtubePrivacyStatus
                                                }
                                                disabled={isLocked}
                                                onChange={(event) =>
                                                  updatePublishDraft(
                                                    job.id,
                                                    account.id,
                                                    fallbackDraft,
                                                    {
                                                      youtubePrivacyStatus:
                                                        event.target
                                                          .value as YouTubePrivacyStatus,
                                                    },
                                                  )
                                                }
                                                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-slate-200 outline-none focus:border-red-300 disabled:opacity-60"
                                              >
                                                <option value="public">
                                                  公开
                                                </option>
                                                <option value="unlisted">
                                                  不公开列出
                                                </option>
                                                <option value="private">
                                                  私享
                                                </option>
                                              </select>
                                            </label>
                                            <label className="text-[10px] text-slate-500">
                                              分类
                                              <select
                                                value={
                                                  publishDraft.youtubeCategoryId
                                                }
                                                disabled={isLocked}
                                                onChange={(event) =>
                                                  updatePublishDraft(
                                                    job.id,
                                                    account.id,
                                                    fallbackDraft,
                                                    {
                                                      youtubeCategoryId:
                                                        event.target.value,
                                                    },
                                                  )
                                                }
                                                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-slate-200 outline-none focus:border-red-300 disabled:opacity-60"
                                              >
                                                {youtubeCategoryOptions.map(
                                                  (option) => (
                                                    <option
                                                      key={option.value}
                                                      value={option.value}
                                                    >
                                                      {option.label}
                                                    </option>
                                                  ),
                                                )}
                                              </select>
                                            </label>
                                            <label className="text-[10px] text-slate-500">
                                              语言
                                              <input
                                                value={
                                                  publishDraft.youtubeLanguage
                                                }
                                                disabled={isLocked}
                                                maxLength={20}
                                                onChange={(event) =>
                                                  updatePublishDraft(
                                                    job.id,
                                                    account.id,
                                                    fallbackDraft,
                                                    {
                                                      youtubeLanguage:
                                                        event.target.value,
                                                    },
                                                  )
                                                }
                                                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-slate-200 outline-none focus:border-red-300 disabled:opacity-60"
                                              />
                                            </label>
                                          </div>
                                          <div className="mt-3 grid gap-2 text-[11px] text-slate-400 sm:grid-cols-3">
                                            <label className="flex items-center gap-2">
                                              <input
                                                type="checkbox"
                                                checked={
                                                  publishDraft.youtubeNotifySubscribers
                                                }
                                                disabled={isLocked}
                                                onChange={(event) =>
                                                  updatePublishDraft(
                                                    job.id,
                                                    account.id,
                                                    fallbackDraft,
                                                    {
                                                      youtubeNotifySubscribers:
                                                        event.target.checked,
                                                    },
                                                  )
                                                }
                                                className="accent-red-300"
                                              />
                                              通知订阅者
                                            </label>
                                            <label className="flex items-center gap-2">
                                              <input
                                                type="checkbox"
                                                checked={
                                                  publishDraft.youtubeContainsSyntheticMedia
                                                }
                                                disabled={isLocked}
                                                onChange={(event) =>
                                                  updatePublishDraft(
                                                    job.id,
                                                    account.id,
                                                    fallbackDraft,
                                                    {
                                                      youtubeContainsSyntheticMedia:
                                                        event.target.checked,
                                                    },
                                                  )
                                                }
                                                className="accent-red-300"
                                              />
                                              含 AI 合成内容
                                            </label>
                                            <label className="flex items-center gap-2">
                                              <input
                                                type="checkbox"
                                                checked={
                                                  publishDraft.youtubeMadeForKids
                                                }
                                                disabled={isLocked}
                                                onChange={(event) =>
                                                  updatePublishDraft(
                                                    job.id,
                                                    account.id,
                                                    fallbackDraft,
                                                    {
                                                      youtubeMadeForKids:
                                                        event.target.checked,
                                                    },
                                                  )
                                                }
                                                className="accent-red-300"
                                              />
                                              面向儿童
                                            </label>
                                          </div>
                                        </div>
                                      ) : account.platform === "instagram" ? (
                                        <div className="mt-3 rounded-lg border border-fuchsia-400/15 bg-fuchsia-400/[0.03] p-3">
                                          <p className="text-[10px] font-semibold tracking-[0.14em] text-fuchsia-300/80 uppercase">
                                            Instagram Reels 设置
                                          </p>
                                          <div className="mt-2 grid items-end gap-3 sm:grid-cols-2">
                                            <label className="flex h-9 items-center gap-2 text-[11px] text-slate-400">
                                              <input
                                                type="checkbox"
                                                checked={
                                                  publishDraft.instagramShareToFeed
                                                }
                                                disabled={isLocked}
                                                onChange={(event) =>
                                                  updatePublishDraft(
                                                    job.id,
                                                    account.id,
                                                    fallbackDraft,
                                                    {
                                                      instagramShareToFeed:
                                                        event.target.checked,
                                                    },
                                                  )
                                                }
                                                className="accent-fuchsia-300"
                                              />
                                              同时分享到个人主页
                                            </label>
                                            <label className="text-[10px] text-slate-500">
                                              封面取帧（秒，可选）
                                              <input
                                                type="number"
                                                min="0"
                                                max={job.durationSeconds}
                                                step="0.1"
                                                value={
                                                  publishDraft.instagramThumbOffsetSeconds
                                                }
                                                disabled={isLocked}
                                                onChange={(event) =>
                                                  updatePublishDraft(
                                                    job.id,
                                                    account.id,
                                                    fallbackDraft,
                                                    {
                                                      instagramThumbOffsetSeconds:
                                                        event.target.value,
                                                    },
                                                  )
                                                }
                                                placeholder="自动选择"
                                                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-slate-200 outline-none focus:border-fuchsia-300 disabled:opacity-60"
                                              />
                                            </label>
                                          </div>
                                        </div>
                                      ) : (
                                        <div className="mt-3 rounded-lg border border-cyan-400/15 bg-cyan-400/[0.03] p-3">
                                          <p className="text-[10px] font-semibold tracking-[0.14em] text-cyan-300/80 uppercase">
                                            抖音设置
                                          </p>
                                          <div className="mt-2 grid items-end gap-3 sm:grid-cols-3">
                                            <label className="text-[10px] text-slate-500">
                                              可见范围
                                              <select
                                                value={
                                                  publishDraft.douyinPrivateStatus
                                                }
                                                disabled={isLocked}
                                                onChange={(event) =>
                                                  updatePublishDraft(
                                                    job.id,
                                                    account.id,
                                                    fallbackDraft,
                                                    {
                                                      douyinPrivateStatus:
                                                        Number(
                                                          event.target.value,
                                                        ) as DouyinPrivateStatus,
                                                    },
                                                  )
                                                }
                                                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-slate-200 outline-none focus:border-cyan-300 disabled:opacity-60"
                                              >
                                                <option value={0}>公开</option>
                                                <option value={1}>
                                                  仅自己
                                                </option>
                                                <option value={2}>
                                                  好友可见
                                                </option>
                                              </select>
                                            </label>
                                            <label className="flex h-9 items-center gap-2 text-[11px] text-slate-400">
                                              <input
                                                type="checkbox"
                                                checked={
                                                  publishDraft.douyinAllowDownload
                                                }
                                                disabled={isLocked}
                                                onChange={(event) =>
                                                  updatePublishDraft(
                                                    job.id,
                                                    account.id,
                                                    fallbackDraft,
                                                    {
                                                      douyinAllowDownload:
                                                        event.target.checked,
                                                    },
                                                  )
                                                }
                                                className="accent-cyan-300"
                                              />
                                              允许下载
                                            </label>
                                            <label className="text-[10px] text-slate-500">
                                              封面取帧（秒，可选）
                                              <input
                                                type="number"
                                                min="0"
                                                max={job.durationSeconds}
                                                step="0.1"
                                                value={
                                                  publishDraft.douyinCoverTimeSeconds
                                                }
                                                disabled={isLocked}
                                                onChange={(event) =>
                                                  updatePublishDraft(
                                                    job.id,
                                                    account.id,
                                                    fallbackDraft,
                                                    {
                                                      douyinCoverTimeSeconds:
                                                        event.target.value,
                                                    },
                                                  )
                                                }
                                                placeholder="自动选择"
                                                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs text-slate-200 outline-none focus:border-cyan-300 disabled:opacity-60"
                                              />
                                            </label>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {selectedAccountIds.length > 0 && (
                          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-cyan-400/15 bg-cyan-400/[0.04] px-3 py-2.5">
                            <div>
                              <p className="text-[10px] font-semibold tracking-[0.14em] text-cyan-300 uppercase">
                                发布计划摘要
                              </p>
                              <p className="mt-1 text-xs text-slate-300">
                                {selectedAccountIds.length} 个账号
                                {` · ${selectedAccountIds.length - selectedScheduledCount} 个立即`}
                                {` · ${selectedScheduledCount} 个定时`}
                              </p>
                            </div>
                            <span className="font-mono text-[10px] text-slate-500">
                              VIDEO → ACCOUNTS → RELEASE
                            </span>
                          </div>
                        )}

                        {platformAccounts.length > 0 && (
                          <button
                            type="button"
                            disabled={
                              selectedAccountIds.length === 0 ||
                              isPublishingThisJob ||
                              hasActivePublish
                            }
                            onClick={() => {
                              setPublishMessages((current) => ({
                                ...current,
                                [job.id]: "",
                              }));
                              const scheduledDraft = selectedPublishDrafts.find(
                                (draft) =>
                                  draft.timing === "scheduled" &&
                                  (!draft.scheduledAt ||
                                    new Date(draft.scheduledAt).getTime() <=
                                      Date.now()),
                              );
                              if (scheduledDraft) {
                                setPublishMessages((current) => ({
                                  ...current,
                                  [job.id]: "定时发布时间必须晚于当前时间。",
                                }));
                                return;
                              }
                              publishMutation.mutate({
                                id: job.id,
                                targets: selectedAccountIds.map((accountId) => {
                                  const account = platformAccounts.find(
                                    (item) => item.id === accountId,
                                  );
                                  const existingTarget =
                                    job.publishTargets.find(
                                      (target) =>
                                        target.accountId === accountId,
                                    );
                                  const fallbackDraft =
                                    createPublishTargetDraft(
                                      existingTarget?.description,
                                      existingTarget?.publishPlan as
                                        | StoredPublishPlan
                                        | null
                                        | undefined,
                                      job.language === "en" ? "en" : "zh",
                                      preferencesQuery.data,
                                    );
                                  const draft =
                                    publishDraftsByJob[job.id]?.[accountId] ??
                                    fallbackDraft;
                                  const thumbOffset = Number(
                                    draft.instagramThumbOffsetSeconds,
                                  );
                                  const douyinCoverTime = Number(
                                    draft.douyinCoverTimeSeconds,
                                  );
                                  return {
                                    accountId,
                                    description:
                                      draft.description.trim() || undefined,
                                    title: draft.title.trim() || undefined,
                                    hashtags:
                                      draft.hashtags.trim() || undefined,
                                    scheduledAt:
                                      draft.timing === "scheduled"
                                        ? new Date(draft.scheduledAt)
                                        : null,
                                    youtube:
                                      account?.platform === "youtube"
                                        ? {
                                            privacyStatus:
                                              draft.youtubePrivacyStatus,
                                            categoryId: draft.youtubeCategoryId,
                                            language: draft.youtubeLanguage,
                                            madeForKids:
                                              draft.youtubeMadeForKids,
                                            containsSyntheticMedia:
                                              draft.youtubeContainsSyntheticMedia,
                                            notifySubscribers:
                                              draft.youtubeNotifySubscribers,
                                          }
                                        : undefined,
                                    instagram:
                                      account?.platform === "instagram"
                                        ? {
                                            shareToFeed:
                                              draft.instagramShareToFeed,
                                            thumbOffsetMs:
                                              draft.instagramThumbOffsetSeconds.trim() &&
                                              Number.isFinite(thumbOffset)
                                                ? Math.round(thumbOffset * 1000)
                                                : null,
                                          }
                                        : undefined,
                                    douyin:
                                      account?.platform === "douyin"
                                        ? {
                                            privateStatus:
                                              draft.douyinPrivateStatus,
                                            allowDownload:
                                              draft.douyinAllowDownload,
                                            coverTimeSeconds:
                                              draft.douyinCoverTimeSeconds.trim() &&
                                              Number.isFinite(douyinCoverTime)
                                                ? douyinCoverTime
                                                : null,
                                          }
                                        : undefined,
                                  };
                                }),
                              });
                            }}
                            className="mt-3 w-full rounded-xl bg-cyan-400 px-4 py-2.5 text-xs font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-45"
                          >
                            {hasActivePublish
                              ? "正在上传…"
                              : isPublishingThisJob
                                ? "正在启动上传…"
                                : `确认发布计划（${selectedAccountIds.length}）`}
                          </button>
                        )}
                        {publishMessages[job.id] && (
                          <p className="mt-2 text-xs text-cyan-300">
                            {publishMessages[job.id]}
                          </p>
                        )}
                      </div>
                    )}
                    {jobActionMessages[job.id] && (
                      <p className="mt-3 text-xs text-cyan-300">
                        {jobActionMessages[job.id]}
                      </p>
                    )}
                  </article>
                );
              })}
              <nav
                aria-label="历史生成分页"
                className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-4"
              >
                <p className="font-mono text-[11px] text-slate-500">
                  PAGE {historyPage.toString().padStart(2, "0")} /{" "}
                  {historyPageCount.toString().padStart(2, "0")}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={historyPage === 1 || historyJobsQuery.isFetching}
                    onClick={() =>
                      setHistoryPage((current) => Math.max(1, current - 1))
                    }
                    className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-300 transition hover:border-cyan-400/50 hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    ← 上一页
                  </button>
                  <span className="inline-flex min-w-9 items-center justify-center rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 font-mono text-xs font-semibold text-cyan-200">
                    {historyPage}
                  </span>
                  <button
                    type="button"
                    disabled={
                      historyPage >= historyPageCount ||
                      historyJobsQuery.isFetching
                    }
                    onClick={() =>
                      setHistoryPage((current) =>
                        Math.min(historyPageCount, current + 1),
                      )
                    }
                    className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-300 transition hover:border-cyan-400/50 hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    下一页 →
                  </button>
                </div>
              </nav>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function GeneratedVideoPlayer({
  jobId,
  title,
}: {
  jobId: string;
  title: string;
}) {
  const playbackUrl = `/api/media-hub/generation/${encodeURIComponent(jobId)}/video`;

  return (
    <div className="mb-4">
      <video
        controls
        playsInline
        preload="metadata"
        src={playbackUrl}
        aria-label={`播放视频：${title}`}
        className="aspect-video w-full rounded-xl border border-slate-800 bg-black object-contain"
      >
        您的浏览器不支持视频播放。
      </video>
      <div className="mt-2 flex justify-end gap-4">
        <a
          href={`${playbackUrl}?download=1`}
          download
          className="text-xs text-cyan-300 underline hover:text-cyan-200"
        >
          下载 MP4
        </a>
        <a
          href={playbackUrl}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-cyan-300 underline hover:text-cyan-200"
        >
          在新窗口打开视频
        </a>
      </div>
    </div>
  );
}

function GeneratedVideoThumbnail({
  jobId,
  title,
  onSelect,
}: {
  jobId: string;
  title: string;
  onSelect: () => void;
}) {
  const playbackUrl = `/api/media-hub/generation/${encodeURIComponent(jobId)}/video`;
  const thumbnailRef = useRef<HTMLButtonElement>(null);
  const [shouldLoadThumbnail, setShouldLoadThumbnail] = useState(false);
  const [thumbnailState, setThumbnailState] = useState<
    "loading" | "ready" | "error"
  >("loading");

  useEffect(() => {
    const thumbnail = thumbnailRef.current;
    if (!thumbnail) return;

    if (!("IntersectionObserver" in window)) {
      const fallbackTimer = setTimeout(() => setShouldLoadThumbnail(true), 0);
      return () => clearTimeout(fallbackTimer);
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setShouldLoadThumbnail(true);
        observer.disconnect();
      },
      { rootMargin: "240px" },
    );

    observer.observe(thumbnail);
    return () => observer.disconnect();
  }, []);

  const seekToThumbnailFrame = (video: HTMLVideoElement) => {
    const targetTime = Number.isFinite(video.duration)
      ? Math.min(1, Math.max(0, video.duration - 0.1))
      : 1;

    if (Math.abs(video.currentTime - targetTime) < 0.01) {
      setThumbnailState("ready");
      return;
    }

    video.currentTime = targetTime;
  };

  return (
    <button
      ref={thumbnailRef}
      type="button"
      onClick={onSelect}
      aria-label={`查看视频并选择发布：${title}`}
      className="group relative mt-4 block aspect-video w-full overflow-hidden rounded-xl border border-slate-800 bg-black text-left transition hover:border-cyan-400/50 focus-visible:border-cyan-300 focus-visible:ring-2 focus-visible:ring-cyan-300/30 focus-visible:outline-none"
    >
      <video
        muted
        playsInline
        preload="metadata"
        src={shouldLoadThumbnail ? playbackUrl : undefined}
        onLoadedMetadata={(event) => seekToThumbnailFrame(event.currentTarget)}
        onSeeked={() => setThumbnailState("ready")}
        onError={() => setThumbnailState("error")}
        aria-hidden="true"
        className={`pointer-events-none size-full object-cover transition-opacity duration-300 motion-reduce:transition-none ${
          thumbnailState === "ready" ? "opacity-100" : "opacity-0"
        }`}
      />
      {thumbnailState !== "ready" && (
        <span className="pointer-events-none absolute inset-0 grid place-items-center bg-[radial-gradient(circle_at_center,rgba(30,41,59,0.8),rgba(2,6,23,0.98))]">
          {thumbnailState === "loading" ? (
            <span className="flex items-center gap-2 text-[11px] text-slate-400">
              <span className="size-3 animate-spin rounded-full border border-slate-600 border-t-cyan-300 motion-reduce:animate-none" />
              正在读取预览画面
            </span>
          ) : (
            <span className="px-6 text-center text-[11px] text-slate-400">
              预览加载失败，可点击查看视频
            </span>
          )}
        </span>
      )}
      <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-slate-950/90 via-transparent to-transparent" />
      <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 p-3">
        <span className="min-w-0 truncate text-xs font-medium text-slate-100">
          视频预览
        </span>
        <span className="shrink-0 rounded-full border border-white/20 bg-slate-950/70 px-3 py-1.5 text-[11px] text-cyan-200 transition group-hover:border-cyan-300/50 group-hover:text-cyan-100">
          ▶ 查看及发布
        </span>
      </span>
    </button>
  );
}

function StatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = {
    scheduled: "已定时",
    queued: "排队中",
    waiting_for_gpu: "等待 GPU",
    running: "生成中",
    succeeded: "已完成",
    failed: "失败",
    canceled: "已取消",
  };
  const colors: Record<string, string> = {
    scheduled: "bg-amber-400/10 text-amber-300",
    queued: "bg-slate-700 text-slate-300",
    waiting_for_gpu: "bg-orange-400/10 text-orange-300",
    running: "bg-cyan-400/10 text-cyan-300",
    succeeded: "bg-emerald-400/10 text-emerald-300",
    failed: "bg-rose-400/10 text-rose-300",
    canceled: "bg-slate-700 text-slate-400",
  };
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-1 text-xs ${colors[status] ?? colors.queued}`}
    >
      {labels[status] ?? status}
    </span>
  );
}

function PublishTargetBadge({
  status,
  externalUrl,
  errorMessage,
  scheduledAt,
}: {
  status: string;
  externalUrl?: string | null;
  errorMessage?: string | null;
  scheduledAt?: string | Date | null;
}) {
  const labels: Record<string, string> = {
    pending: "待上传",
    publishing: "上传中",
    published: "已发布",
    failed: "失败，可重试",
  };
  const colors: Record<string, string> = {
    pending: "text-slate-400",
    publishing: "text-cyan-300",
    published: "text-emerald-300",
    failed: "text-rose-300",
  };
  const content =
    status === "pending" && scheduledAt
      ? `定时 ${new Date(scheduledAt).toLocaleString([], {
          month: "numeric",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })}`
      : (labels[status] ?? status);

  if (status === "published" && externalUrl) {
    return (
      <a
        href={externalUrl}
        target="_blank"
        rel="noreferrer"
        onClick={(event) => event.stopPropagation()}
        className="shrink-0 text-[11px] text-emerald-300 underline hover:text-emerald-200"
      >
        查看发布
      </a>
    );
  }

  return (
    <span
      title={errorMessage ?? undefined}
      className={`min-w-0 shrink-0 text-[11px] ${colors[status] ?? "text-slate-400"}`}
    >
      {status === "failed" && errorMessage ? `失败：${errorMessage}` : content}
    </span>
  );
}
