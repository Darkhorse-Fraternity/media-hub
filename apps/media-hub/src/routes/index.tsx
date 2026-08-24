import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import { mediaHubSignInSchema } from "@acme/validators";

import type { ContentLanguage } from "~/lib/content-language";
import type { ResolutionValue } from "~/lib/generation-resolution";
import type {
  ReferenceImageContentType,
  ReferenceImageDraft,
  ReferenceImageRole,
} from "~/lib/media-generation-form";
import { authClient } from "~/auth/client";
import {
  contentLanguageStorageKey,
  defaultContentLanguage,
  parseContentLanguage,
} from "~/lib/content-language";
import { formatGenerationElapsed } from "~/lib/generation-display";
import { resolutionOptions } from "~/lib/generation-resolution";
import {
  createReferenceImageDraftId,
  referenceImageContentTypes,
  resolveScheduledAt,
  scheduleDayOptions,
  scheduleTimeOptions,
  uploadReferenceImage,
} from "~/lib/media-generation-form";
import {
  compressReferenceImage,
  formatImageBytes,
  maxReferenceImageBytes,
  maxReferenceImageMegabytes,
} from "~/lib/reference-image-compression";
import { useTRPC } from "~/lib/trpc";

export const Route = createFileRoute("/")({
  component: MediaHubHome,
});

const durationOptions = [15, 30, 45, 60] as const;
type DurationSeconds = (typeof durationOptions)[number];

const maxReferenceImages = 5;

interface GenerationEditDraft {
  id: string;
  prompt: string;
  title: string;
  language: ContentLanguage;
  durationSeconds: DurationSeconds;
  scheduleDay: string;
  scheduleTime: string;
}

type PublishTiming = "now" | "scheduled";
type YouTubePrivacyStatus = "public" | "unlisted" | "private";

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
): PublishTargetDraft {
  return {
    title: plan?.title ?? "",
    description: description ?? "",
    hashtags: plan?.hashtags ?? "",
    timing: plan?.scheduledAt ? "scheduled" : "now",
    scheduledAt: plan?.scheduledAt
      ? toDateTimeLocal(plan.scheduledAt)
      : defaultPublishDateTime(),
    youtubePrivacyStatus: plan?.youtube.privacyStatus ?? "public",
    youtubeCategoryId: plan?.youtube.categoryId ?? "22",
    youtubeLanguage:
      plan?.youtube.language ?? (contentLanguage === "en" ? "en" : "zh-Hans"),
    youtubeMadeForKids: plan?.youtube.madeForKids ?? false,
    youtubeContainsSyntheticMedia: plan?.youtube.containsSyntheticMedia ?? true,
    youtubeNotifySubscribers: plan?.youtube.notifySubscribers ?? true,
    instagramShareToFeed: plan?.instagram.shareToFeed ?? true,
    instagramThumbOffsetSeconds:
      plan?.instagram.thumbOffsetMs === null ||
      plan?.instagram.thumbOffsetMs === undefined
        ? ""
        : String(plan.instagram.thumbOffsetMs / 1000),
  };
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

function MediaHubHome() {
  const sessionQuery = authClient.useSession();

  if (sessionQuery.isPending) {
    return <SessionLoadingScreen />;
  }

  if (!sessionQuery.data?.user) {
    return <LoginScreen onSuccess={() => void sessionQuery.refetch()} />;
  }

  return (
    <MediaHubDashboard
      currentUser={{
        id: sessionQuery.data.user.id,
        name: sessionQuery.data.user.name,
        email: sessionQuery.data.user.email,
      }}
      isAdmin={sessionQuery.data.user.role === "admin"}
      onSignOut={() => void sessionQuery.refetch()}
    />
  );
}

function MediaHubDashboard({
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
  const [prompt, setPrompt] = useState("");
  const [title, setTitle] = useState("");
  const [contentLanguage, setContentLanguage] = useState<ContentLanguage>(
    defaultContentLanguage,
  );
  const [durationSeconds, setDurationSeconds] = useState<DurationSeconds>(30);
  const [resolutionValue, setResolutionValue] =
    useState<ResolutionValue>("960x544");
  const [scheduleDay, setScheduleDay] = useState("now");
  const [scheduleTime, setScheduleTime] = useState("09:00");
  const [referenceImages, setReferenceImages] = useState<ReferenceImageDraft[]>(
    [],
  );
  const referenceImagesRef = useRef<ReferenceImageDraft[]>([]);
  const [preparingImages, setPreparingImages] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [showPlatformManagement, setShowPlatformManagement] = useState(false);
  const [showUserManagement, setShowUserManagement] = useState(false);
  const [showApiManagement, setShowApiManagement] = useState(false);
  const [isFloatingQueueOpen, setIsFloatingQueueOpen] = useState(true);
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

  useEffect(() => {
    referenceImagesRef.current = referenceImages;
  }, [referenceImages]);

  useEffect(() => {
    const savedLanguage = window.localStorage.getItem(
      contentLanguageStorageKey(currentUser.id),
    );
    setContentLanguage(parseContentLanguage(savedLanguage));
  }, [currentUser.id]);

  useEffect(
    () => () => {
      referenceImagesRef.current.forEach((image) =>
        URL.revokeObjectURL(image.previewUrl),
      );
    },
    [],
  );

  const clearReferenceImages = () => {
    setReferenceImages((current) => {
      current.forEach((image) => URL.revokeObjectURL(image.previewUrl));
      return [];
    });
  };

  const updateContentLanguage = (language: ContentLanguage) => {
    setContentLanguage(language);
    window.localStorage.setItem(
      contentLanguageStorageKey(currentUser.id),
      language,
    );
  };

  const addReferenceImages = async (files: File[]) => {
    const supported = files.filter((file) =>
      referenceImageContentTypes.has(file.type as ReferenceImageContentType),
    );
    const notices: string[] = [];
    if (supported.length !== files.length)
      notices.push("仅支持 JPEG、PNG 或 WebP 图片。");

    const available = maxReferenceImages - referenceImagesRef.current.length;
    const selected = supported.slice(0, available);
    if (supported.length > available)
      notices.push(`最多选择 ${maxReferenceImages} 张参考图片。`);
    if (selected.length === 0) {
      if (notices.length > 0) setMessage(notices.join(" "));
      return;
    }

    const oversizedCount = selected.filter(
      (file) => file.size > maxReferenceImageBytes,
    ).length;
    setPreparingImages(true);
    if (oversizedCount > 0)
      setMessage(`正在自动压缩 ${oversizedCount} 张较大图片…`);

    try {
      const prepared = [];
      for (const file of selected) {
        prepared.push(await compressReferenceImage(file));
      }
      const compressed = prepared.filter((result) => result.compressed);
      const firstCompressed = compressed[0];
      if (firstCompressed)
        notices.push(
          `已自动压缩 ${compressed.length} 张图片（${formatImageBytes(firstCompressed.originalBytes)} → ${formatImageBytes(firstCompressed.file.size)}）。`,
        );

      const preparedFiles = prepared.map((result) => result.file);
      setReferenceImages((current) => {
        const hasFirstFrame = current.some(
          (image) => image.role === "first_frame",
        );
        return [
          ...current,
          ...preparedFiles.map((file, index) => ({
            id: createReferenceImageDraftId(),
            file,
            previewUrl: URL.createObjectURL(file),
            role:
              !hasFirstFrame && index === 0
                ? ("first_frame" as const)
                : ("subject" as const),
          })),
        ];
      });
      setMessage(notices.length > 0 ? notices.join(" ") : null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "图片自动压缩失败");
    } finally {
      setPreparingImages(false);
    }
  };

  const setReferenceImageRole = (id: string, role: ReferenceImageRole) => {
    setReferenceImages((current) => {
      const target = current.find((image) => image.id === id);
      if (!target || target.role === role) return current;
      if (role === "first_frame") {
        return current.map((image) =>
          image.id === id
            ? { ...image, role }
            : image.role === "first_frame"
              ? { ...image, role: "subject" }
              : image,
        );
      }
      const replacement = current.find(
        (image) => image.id !== id && image.role !== "first_frame",
      );
      if (target.role === "first_frame" && !replacement) {
        setMessage("至少保留一张首帧图；也可以直接删除全部参考图。 ");
        return current;
      }
      return current.map((image) => {
        if (image.id === id) return { ...image, role };
        if (target.role === "first_frame" && image.id === replacement?.id) {
          return { ...image, role: "first_frame" };
        }
        return image;
      });
    });
  };

  const removeReferenceImage = (id: string) => {
    setReferenceImages((current) => {
      const removed = current.find((image) => image.id === id);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      const remaining = current.filter((image) => image.id !== id);
      if (
        removed?.role === "first_frame" &&
        remaining.length > 0 &&
        !remaining.some((image) => image.role === "first_frame")
      ) {
        return remaining.map((image, index) =>
          index === 0 ? { ...image, role: "first_frame" } : image,
        );
      }
      return remaining;
    });
  };

  const jobsQuery = useQuery(
    trpc.mediaHub.generation.list.queryOptions(
      { page: 1, pageSize: 100 },
      { refetchInterval: 5000 },
    ),
  );
  const providerHealthQuery = useQuery(
    trpc.mediaHub.generation.providerHealth.queryOptions(undefined, {
      refetchInterval: 15_000,
      retry: false,
    }),
  );
  const accountsQuery = useQuery(trpc.mediaHub.account.list.queryOptions({}));
  const createMutation = useMutation(
    trpc.mediaHub.generation.create.mutationOptions({
      onSuccess: () => {
        setPrompt("");
        setTitle("");
        setDurationSeconds(30);
        setScheduleDay("now");
        setScheduleTime("09:00");
        clearReferenceImages();
        setMessage("任务已创建");
        void queryClient.invalidateQueries({
          queryKey: trpc.mediaHub.generation.list.queryKey(),
        });
      },
    }),
  );
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
  const optimizePromptMutation = useMutation(
    trpc.mediaHub.ai.optimizePrompt.mutationOptions(),
  );
  const optimizePlatformDescriptionMutation = useMutation(
    trpc.mediaHub.ai.optimizePlatformDescription.mutationOptions(),
  );

  const optimizeCreatePrompt = async () => {
    if (!prompt.trim()) return;
    setOptimizingPromptContext("create");
    setMessage("Codex Worker 正在优化提示词…");
    try {
      const result = await optimizePromptMutation.mutateAsync({
        prompt: prompt.trim(),
        language: contentLanguage,
        title: title.trim() || undefined,
        durationSeconds,
        hasReferenceImage: referenceImages.length > 0,
      });
      setPrompt(result.text);
      setMessage("提示词已优化，可以继续修改或直接生成。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "提示词优化失败");
    } finally {
      setOptimizingPromptContext(null);
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!prompt.trim()) return;
    if (preparingImages) {
      setMessage("图片仍在压缩，请稍候再开始生成。");
      return;
    }
    const scheduledAt = resolveScheduledAt(scheduleDay, scheduleTime);
    const resolution =
      resolutionOptions.find((option) => option.value === resolutionValue) ??
      resolutionOptions[0];
    if (scheduledAt && scheduledAt.getTime() <= Date.now()) {
      setMessage("定点执行时间必须晚于当前时间");
      return;
    }
    setUploading(true);
    setMessage(null);
    try {
      const uploadedImages = await Promise.all(
        referenceImages.map(async (image) => {
          const uploaded = await uploadReferenceImage(image.file);
          return {
            storageKey: uploaded.key,
            name: image.file.name,
            contentType: uploaded.contentType,
            role: image.role,
          };
        }),
      );
      const firstFrame = uploadedImages.find(
        (image) => image.role === "first_frame",
      );
      await createMutation.mutateAsync({
        prompt: prompt.trim(),
        language: contentLanguage,
        title: title.trim() || undefined,
        sourceImageStorageKey: firstFrame?.storageKey,
        sourceImageName: firstFrame?.name,
        sourceImageContentType: firstFrame?.contentType,
        referenceImages: uploadedImages.flatMap((image) =>
          image.role === "first_frame"
            ? []
            : [
                {
                  storageKey: image.storageKey,
                  name: image.name,
                  contentType: image.contentType,
                  role: image.role,
                },
              ],
        ),
        durationSeconds,
        scheduledAt,
        width: resolution.width,
        height: resolution.height,
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "创建任务失败");
    } finally {
      setUploading(false);
    }
  };

  const jobs = jobsQuery.data?.rows ?? [];
  type DetailedGenerationJob = Extract<
    (typeof jobs)[number],
    { isPrivate: false }
  >;
  const activeJobs = jobs.filter(
    (job) =>
      job.isPrivate || ["scheduled", "queued", "running"].includes(job.status),
  );
  const historyJobs = jobs.filter(
    (job): job is DetailedGenerationJob =>
      !job.isPrivate &&
      ["succeeded", "failed", "canceled"].includes(job.status),
  );
  const platformAccounts = (accountsQuery.data ?? []).filter((account) =>
    ["youtube", "instagram"].includes(account.platform),
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
      scheduledAt,
    });
  };

  const optimizeEditingPrompt = async (job: DetailedGenerationJob) => {
    if (!editingJob?.prompt.trim()) return;
    const editingId = editingJob.id;
    setOptimizingPromptContext(editingId);
    setJobActionMessages((current) => ({
      ...current,
      [editingId]: "Codex Worker 正在优化提示词…",
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
      `⚠️ 永久删除“${label}”的本地记录吗？\n\nMedia Hub 中的视频文件、参考图片、任务和发布记录都会被删除，且无法恢复。已经发布到平台的内容会继续保留，不会从 YouTube 或 Instagram 删除。`,
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
    job: (typeof jobs)[number];
    account: (typeof platformAccounts)[number];
    currentDescription: string;
    fallbackDraft: PublishTargetDraft;
  }) => {
    const key = `${job.id}:${account.id}`;
    setOptimizingCopyKey(key);
    setPublishMessages((current) => ({
      ...current,
      [job.id]: `Codex Worker 正在${currentDescription.trim() ? "优化" : "生成"} ${account.platform} 文案…`,
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
    <main className="min-h-screen bg-slate-950 p-6 text-slate-100">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-medium text-cyan-300">
              PUMPKII MEDIA HUB
            </p>
            <h1 className="mt-2 text-3xl font-semibold">AI 视频生成后台</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-400">
              使用 MiniMax H3 根据文字和参考图片生成 15–60
              秒视频。生成完成后会自动进入媒体草稿，可继续审核和发布。
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div className="hidden text-right sm:block">
              <p className="text-xs font-medium text-slate-200">
                {currentUser.name}
              </p>
              <p className="text-[11px] text-slate-500">{currentUser.email}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setShowPlatformManagement((current) => !current);
                setShowUserManagement(false);
                setShowApiManagement(false);
              }}
              className={`rounded-xl border px-3 py-2 text-xs font-medium transition focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:outline-none ${
                showPlatformManagement
                  ? "border-cyan-400/50 bg-cyan-400/10 text-cyan-200"
                  : "border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-600"
              }`}
            >
              平台管理
            </button>
            {isAdmin && (
              <button
                type="button"
                onClick={() => {
                  setShowUserManagement((current) => !current);
                  setShowPlatformManagement(false);
                  setShowApiManagement(false);
                }}
                className={`rounded-xl border px-3 py-2 text-xs font-medium transition focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:outline-none ${
                  showUserManagement
                    ? "border-cyan-400/50 bg-cyan-400/10 text-cyan-200"
                    : "border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-600"
                }`}
              >
                用户管理
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setShowApiManagement((current) => !current);
                setShowPlatformManagement(false);
                setShowUserManagement(false);
              }}
              className={`rounded-xl border px-3 py-2 text-xs font-medium transition focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:outline-none ${
                showApiManagement
                  ? "border-violet-400/50 bg-violet-400/10 text-violet-200"
                  : "border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-600"
              }`}
            >
              Agent API
            </button>
            <button
              type="button"
              onClick={() => {
                void authClient.signOut({
                  fetchOptions: { onSuccess: onSignOut },
                });
              }}
              className="rounded-xl border border-slate-800 px-3 py-2 text-xs text-slate-400 transition hover:border-rose-400/40 hover:text-rose-300 focus-visible:ring-2 focus-visible:ring-rose-300 focus-visible:outline-none"
            >
              退出
            </button>
          </div>
        </header>

        {isAdmin && showUserManagement && (
          <UserManagementPanel currentUserId={currentUser.id} />
        )}

        {showApiManagement && <AgentApiManagementPanel />}

        {showPlatformManagement && (
          <PlatformAccountManagementPanel isAdmin={isAdmin} />
        )}

        <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.85fr)]">
          <form
            onSubmit={(event) => void submit(event)}
            className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl"
          >
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-semibold">创建生成任务</h2>
              <span className="rounded-full bg-cyan-400/10 px-3 py-1 text-xs text-cyan-300">
                MiniMax H3 · {durationSeconds}s
              </span>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm text-slate-300">
                任务名称（可选）
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="自动视频"
                  className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm outline-none focus:border-cyan-400"
                />
              </label>
              <label className="block text-sm text-slate-300">
                视频时长
                <select
                  value={durationSeconds}
                  onChange={(event) =>
                    setDurationSeconds(
                      Number(event.target.value) as DurationSeconds,
                    )
                  }
                  className="mt-2 w-full cursor-pointer rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm outline-none focus:border-cyan-400"
                >
                  {durationOptions.map((seconds) => (
                    <option key={seconds} value={seconds}>
                      {seconds} 秒
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm text-slate-300">
                内容语言
                <select
                  value={contentLanguage}
                  onChange={(event) =>
                    updateContentLanguage(event.target.value as ContentLanguage)
                  }
                  className="mt-2 w-full cursor-pointer rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm outline-none focus:border-cyan-400"
                >
                  <option value="zh">中文</option>
                  <option value="en">English</option>
                </select>
                <span className="mt-2 block text-xs leading-5 text-slate-500">
                  默认英文。选择会按当前账号保存在此浏览器；AI
                  优化提示词和平台发布文案都会使用所选语言。
                </span>
              </label>
              <label className="block text-sm text-slate-300">
                分辨率 / 画幅
                <select
                  value={resolutionValue}
                  onChange={(event) =>
                    setResolutionValue(event.target.value as ResolutionValue)
                  }
                  className="mt-2 w-full cursor-pointer rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm outline-none focus:border-cyan-400"
                >
                  {resolutionOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <span className="mt-2 block text-xs leading-5 text-slate-500">
                  高清档生成更慢，也会占用更多显存。
                </span>
              </label>
            </div>
            <div className="mt-4">
              <div className="flex items-center justify-between gap-3">
                <label
                  htmlFor="generation-prompt"
                  className="text-sm text-slate-300"
                >
                  视频描述 / 动作提示词
                </label>
                <button
                  type="button"
                  disabled={!prompt.trim() || optimizingPromptContext !== null}
                  onClick={() => void optimizeCreatePrompt()}
                  className="rounded-lg border border-violet-400/30 bg-violet-400/5 px-3 py-1.5 text-xs font-medium text-violet-200 transition hover:border-violet-300/50 hover:bg-violet-400/10 focus-visible:ring-2 focus-visible:ring-violet-300 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {optimizingPromptContext === "create"
                    ? "AI 优化中…"
                    : "✦ AI 优化提示词"}
                </button>
              </div>
              <textarea
                id="generation-prompt"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                required
                rows={7}
                placeholder="例如：一只柴犬在阳光明亮的客厅里追逐一个红色小球，镜头缓慢跟随，真实自然的动作，电影感光影"
                className="mt-2 w-full resize-y rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm transition outline-none focus:border-cyan-400"
              />
              <p className="mt-2 text-xs text-slate-500">
                Codex Worker 会保留原意，并补全镜头、动作节奏和场景连续性。
              </p>
            </div>
            <fieldset className="mt-4 rounded-xl border border-slate-800 bg-slate-950/40 p-4">
              <legend className="px-1 text-sm text-slate-300">定点执行</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-xs text-slate-400">
                  执行日期
                  <select
                    value={scheduleDay}
                    onChange={(event) => setScheduleDay(event.target.value)}
                    className="mt-2 w-full cursor-pointer rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm text-slate-200 outline-none focus:border-cyan-400"
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
                    value={scheduleTime}
                    onChange={(event) => setScheduleTime(event.target.value)}
                    disabled={scheduleDay === "now"}
                    className="mt-2 w-full cursor-pointer rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm text-slate-200 outline-none focus:border-cyan-400 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {scheduleTimeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </fieldset>
            <div className="mt-4">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-sm text-slate-300">参考图片（可选）</p>
                  <p className="mt-1 text-xs text-slate-500">
                    最多 {maxReferenceImages} 张；必须明确 1
                    张首帧，其余标记为风格或主体参考；大图会自动压缩到{" "}
                    {maxReferenceImageMegabytes} MB 以内。
                  </p>
                </div>
                <span className="text-xs text-slate-500">
                  {referenceImages.length} / {maxReferenceImages}
                </span>
              </div>
              <label
                className={`mt-2 block rounded-xl border border-dashed border-slate-700 bg-slate-950 px-4 py-3 text-sm text-slate-400 ${
                  referenceImages.length >= maxReferenceImages ||
                  preparingImages
                    ? "cursor-not-allowed opacity-50"
                    : "cursor-pointer hover:border-cyan-400/60"
                }`}
              >
                <span>
                  {preparingImages
                    ? "正在压缩图片…"
                    : referenceImages.length >= maxReferenceImages
                      ? "已达到图片上限"
                      : "选择一张或多张图片"}
                </span>
                <input
                  type="file"
                  multiple
                  disabled={
                    referenceImages.length >= maxReferenceImages ||
                    preparingImages
                  }
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(event) => {
                    const files = Array.from(event.target.files ?? []);
                    event.currentTarget.value = "";
                    void addReferenceImages(files);
                  }}
                  className="sr-only"
                />
              </label>
              {referenceImages.length > 0 && (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {referenceImages.map((image, index) => (
                    <div
                      key={image.id}
                      className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/70"
                    >
                      <img
                        src={image.previewUrl}
                        alt={`参考图片 ${index + 1}`}
                        className="h-36 w-full object-cover"
                      />
                      <div className="space-y-2 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="min-w-0 flex-1 truncate text-xs text-slate-300">
                            {image.file.name} ·{" "}
                            {formatImageBytes(image.file.size)}
                          </p>
                          <button
                            type="button"
                            onClick={() => removeReferenceImage(image.id)}
                            className="shrink-0 text-xs text-rose-300 underline hover:text-rose-200"
                          >
                            删除
                          </button>
                        </div>
                        <label className="block text-[11px] text-slate-500">
                          图片用途
                          <select
                            value={image.role}
                            onChange={(event) =>
                              setReferenceImageRole(
                                image.id,
                                event.target.value as ReferenceImageRole,
                              )
                            }
                            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-200 outline-none focus:border-cyan-400"
                          >
                            <option value="first_frame">
                              首帧（画面起点）
                            </option>
                            <option value="subject">
                              主体参考（保持人物/物体）
                            </option>
                            <option value="style">风格参考（色彩/质感）</option>
                          </select>
                        </label>
                        <p className="text-[10px] leading-4 text-slate-600">
                          {image.role === "first_frame"
                            ? "视频从这张画面开始，构图约束最强。"
                            : image.role === "subject"
                              ? `作为 <Picture ${
                                  referenceImages
                                    .filter(
                                      (item) => item.role !== "first_frame",
                                    )
                                    .findIndex((item) => item.id === image.id) +
                                  1
                                }> 保持主体一致性。`
                              : `作为 <Picture ${
                                  referenceImages
                                    .filter(
                                      (item) => item.role !== "first_frame",
                                    )
                                    .findIndex((item) => item.id === image.id) +
                                  1
                                }> 参考视觉风格。`}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="mt-5 flex items-center justify-between gap-4">
              <p className="text-xs text-slate-500">
                H3 单段约 15 秒，后台将自动生成 {durationSeconds / 15}
                段并拼接为约 {durationSeconds} 秒。
              </p>
              <button
                type="submit"
                disabled={
                  preparingImages ||
                  uploading ||
                  createMutation.isPending ||
                  !prompt.trim()
                }
                className="rounded-xl bg-cyan-400 px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {uploading
                  ? "上传中…"
                  : createMutation.isPending
                    ? "创建中…"
                    : "开始生成"}
              </button>
            </div>
            {message && <p className="mt-4 text-sm text-cyan-300">{message}</p>}
          </form>

          <section className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl">
            <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
              <h2 className="text-lg font-semibold">历史生成</h2>
              <span className="text-xs text-slate-500">
                {historyJobs.length} 条历史记录 · 每 5 秒刷新
              </span>
            </div>
            {historyJobs.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-700 px-4 py-12 text-center text-sm text-slate-500">
                暂无历史生成记录
              </div>
            ) : (
              <div className="space-y-3">
                {historyJobs.map((job) => {
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
                  const canCancel = ["scheduled", "queued", "running"].includes(
                    job.status,
                  );
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
                  const isSelectedForPublishing =
                    selectedPublishJobId === job.id;
                  const trimmedJobTitle = job.title?.trim();
                  const jobLabel =
                    trimmedJobTitle && trimmedJobTitle.length > 0
                      ? trimmedJobTitle
                      : job.prompt;
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
                            {` · ${job.kind === "edit" ? "Ref2VA 修改" : "H3 生成"}`}
                            {` · 视频 ${job.durationSeconds} 秒`}
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
                          <p className="mt-1 text-[11px] text-slate-600">
                            创建人：
                            {job.creator
                              ? `${job.creator.name} · ${job.creator.email}`
                              : job.createdBy}
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
                                    {isRetryingThisJob
                                      ? "正在重试…"
                                      : "重试任务"}
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
                                  <option
                                    key={option.value}
                                    value={option.value}
                                  >
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
                                  <option
                                    key={option.value}
                                    value={option.value}
                                  >
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
                        <p className="mt-3 text-xs text-rose-300">
                          {job.errorMessage}
                        </p>
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
                      {job.status === "succeeded" &&
                        !isSelectedForPublishing && (
                          <GeneratedVideoThumbnail
                            jobId={job.id}
                            title={jobLabel}
                            onSelect={() => setSelectedPublishJobId(job.id)}
                          />
                        )}
                      {job.status === "succeeded" &&
                        isSelectedForPublishing && (
                          <div className="mt-4 border-t border-slate-800 pt-4">
                            <GeneratedVideoPlayer
                              jobId={job.id}
                              title={jobLabel}
                            />
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
                                暂无已绑定的 YouTube 或 Instagram 账户。
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
                                  const fallbackDraft =
                                    createPublishTargetDraft(
                                      target?.description,
                                      target?.publishPlan as
                                        | StoredPublishPlan
                                        | null
                                        | undefined,
                                      job.language === "en" ? "en" : "zh",
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
                                          className={`rounded-md px-2 py-1 text-[10px] font-semibold tracking-wide uppercase ${
                                            account.platform === "youtube"
                                              ? "bg-red-400/10 text-red-300"
                                              : "bg-fuchsia-400/10 text-fuchsia-300"
                                          }`}
                                        >
                                          {account.platform}
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
                                                      hashtags:
                                                        event.target.value,
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
                                                  void optimizePlatformDescription(
                                                    {
                                                      job,
                                                      account,
                                                      currentDescription:
                                                        platformDescription,
                                                      fallbackDraft,
                                                    },
                                                  )
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
                                                  description:
                                                    event.target.value,
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
                                                min={toDateTimeLocal(
                                                  new Date(),
                                                )}
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
                                                            event.target
                                                              .checked,
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
                                                            event.target
                                                              .checked,
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
                                                            event.target
                                                              .checked,
                                                        },
                                                      )
                                                    }
                                                    className="accent-red-300"
                                                  />
                                                  面向儿童
                                                </label>
                                              </div>
                                            </div>
                                          ) : (
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
                                                            event.target
                                                              .checked,
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
                                  const scheduledDraft =
                                    selectedPublishDrafts.find(
                                      (draft) =>
                                        draft.timing === "scheduled" &&
                                        (!draft.scheduledAt ||
                                          new Date(
                                            draft.scheduledAt,
                                          ).getTime() <= Date.now()),
                                    );
                                  if (scheduledDraft) {
                                    setPublishMessages((current) => ({
                                      ...current,
                                      [job.id]:
                                        "定时发布时间必须晚于当前时间。",
                                    }));
                                    return;
                                  }
                                  publishMutation.mutate({
                                    id: job.id,
                                    targets: selectedAccountIds.map(
                                      (accountId) => {
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
                                          );
                                        const draft =
                                          publishDraftsByJob[job.id]?.[
                                            accountId
                                          ] ?? fallbackDraft;
                                        const thumbOffset = Number(
                                          draft.instagramThumbOffsetSeconds,
                                        );
                                        return {
                                          accountId,
                                          description:
                                            draft.description.trim() ||
                                            undefined,
                                          title:
                                            draft.title.trim() || undefined,
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
                                                  categoryId:
                                                    draft.youtubeCategoryId,
                                                  language:
                                                    draft.youtubeLanguage,
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
                                                      ? Math.round(
                                                          thumbOffset * 1000,
                                                        )
                                                      : null,
                                                }
                                              : undefined,
                                        };
                                      },
                                    ),
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
              </div>
            )}
          </section>
        </section>
      </div>
      <aside className="fixed bottom-4 left-4 z-40 w-[min(26rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-cyan-400/25 bg-slate-950/95 shadow-[0_24px_80px_rgba(2,8,23,0.65)] backdrop-blur-xl">
        <button
          type="button"
          aria-expanded={isFloatingQueueOpen}
          aria-controls="floating-generation-queue"
          onClick={() => setIsFloatingQueueOpen((current) => !current)}
          className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition hover:bg-slate-900/80"
        >
          <span className="flex min-w-0 items-center gap-3">
            <span
              className="relative flex size-2.5 shrink-0"
              aria-hidden="true"
            >
              {activeJobs.length > 0 && (
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-cyan-400 opacity-40 motion-reduce:animate-none" />
              )}
              <span
                className={`relative inline-flex size-2.5 rounded-full ${
                  activeJobs.length > 0 ? "bg-cyan-300" : "bg-slate-600"
                }`}
              />
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-semibold text-slate-100">
                正在生成与未来任务
              </span>
              <span className="mt-0.5 block text-[10px] text-slate-500">
                {activeJobs.length} 个活动任务 · H3
                {providerHealthQuery.data?.status === "healthy"
                  ? " 正常"
                  : providerHealthQuery.isFetching
                    ? " 检查中"
                    : " 异常"}
              </span>
            </span>
          </span>
          <span className="text-[11px] text-cyan-300">
            {isFloatingQueueOpen ? "收起" : "展开"}
          </span>
        </button>

        {isFloatingQueueOpen && (
          <div
            id="floating-generation-queue"
            className="max-h-[min(62vh,34rem)] space-y-2 overflow-y-auto border-t border-slate-800 p-3"
          >
            <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`inline-flex min-w-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] ${
                    providerHealthQuery.data?.status === "healthy"
                      ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                      : providerHealthQuery.isFetching
                        ? "border-slate-700 bg-slate-800/70 text-slate-400"
                        : "border-rose-400/30 bg-rose-400/10 text-rose-300"
                  }`}
                  title={
                    providerHealthQuery.data?.message ??
                    "正在检查 H3 Provider 链路"
                  }
                >
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      providerHealthQuery.data?.status === "healthy"
                        ? "bg-emerald-300"
                        : providerHealthQuery.isFetching
                          ? "bg-slate-500"
                          : "bg-rose-300"
                    }`}
                  />
                  <span className="truncate">
                    {providerHealthQuery.data?.status === "healthy"
                      ? `H3 链路正常 · ${providerHealthQuery.data.latencyMs ?? 0} ms${
                          providerHealthQuery.data.providerVersion
                            ? ` · ${providerHealthQuery.data.providerVersion}`
                            : ""
                        }`
                      : providerHealthQuery.isFetching
                        ? "正在检查 H3 链路…"
                        : "H3 链路异常"}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={providerHealthQuery.isFetching}
                  onClick={() => void providerHealthQuery.refetch()}
                  className="shrink-0 rounded-lg border border-slate-700 px-2.5 py-1 text-[10px] text-slate-400 transition hover:border-slate-600 hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {providerHealthQuery.isFetching ? "检查中…" : "重新检查"}
                </button>
              </div>
              {providerHealthQuery.data?.status !== "healthy" &&
                providerHealthQuery.data?.message && (
                  <p className="mt-2 text-[10px] leading-4 text-rose-300/80">
                    {providerHealthQuery.data.message}
                  </p>
                )}
            </div>
            {activeJobs.length === 0 && (
              <div className="rounded-xl border border-dashed border-slate-800 px-3 py-4 text-center">
                <p className="text-xs text-slate-400">当前没有活动任务</p>
                <p className="mt-1 text-[10px] text-slate-600">
                  新建或定时任务后会出现在这里。
                </p>
              </div>
            )}
            {activeJobs.map((job) => {
              if (job.isPrivate) {
                return (
                  <div
                    key={job.id}
                    className="rounded-xl border border-slate-800 bg-slate-900/70 px-3 py-3"
                  >
                    <p className="text-xs text-slate-300">
                      其他成员有任务进行中
                    </p>
                    <p className="mt-1 text-[10px] text-slate-600">
                      为保护隐私，任务内容仅创建人可见。
                    </p>
                  </div>
                );
              }

              const currentQueueEdit =
                editingJob?.id === job.id ? editingJob : null;
              const isUpdatingQueueJob =
                updateMutation.isPending &&
                updateMutation.variables.id === job.id;
              const isCancelingQueueJob =
                cancelMutation.isPending &&
                cancelMutation.variables.id === job.id;
              const canEditQueueJob = ["scheduled", "queued"].includes(
                job.status,
              );
              const queueJobTitle = job.title?.trim() ?? job.prompt;
              const queueElapsed = formatGenerationElapsed(
                job.startedAt,
                job.finishedAt,
              );

              return (
                <article
                  key={job.id}
                  className="rounded-xl border border-slate-800 bg-slate-900/70 p-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-slate-200">
                        {queueJobTitle}
                      </p>
                      <p className="mt-1 text-[10px] text-slate-500">
                        {job.status === "scheduled" && job.scheduledAt
                          ? `定于 ${new Date(job.scheduledAt).toLocaleString()}`
                          : job.status === "running"
                            ? `正在生成${queueElapsed ? ` · ${queueElapsed}` : ""}`
                            : "等待 GPU 队列执行"}
                      </p>
                    </div>
                    <StatusBadge status={job.status} />
                  </div>

                  {!currentQueueEdit && (
                    <div className="mt-3 flex items-center justify-end gap-3 border-t border-slate-800 pt-2.5">
                      {canEditQueueJob && (
                        <button
                          type="button"
                          onClick={() => beginEditingJob(job)}
                          className="text-[11px] text-cyan-300 transition hover:text-cyan-200"
                        >
                          修改任务
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={isCancelingQueueJob}
                        onClick={() => confirmCancelJob(job)}
                        className="text-[11px] text-rose-300 transition hover:text-rose-200 disabled:opacity-50"
                      >
                        {isCancelingQueueJob ? "正在取消…" : "取消任务"}
                      </button>
                    </div>
                  )}

                  {currentQueueEdit && (
                    <div className="mt-3 space-y-3 border-t border-slate-800 pt-3">
                      <input
                        aria-label="任务名称"
                        value={currentQueueEdit.title}
                        placeholder="任务名称（可选）"
                        onChange={(event) =>
                          setEditingJob((current) =>
                            current?.id === job.id
                              ? { ...current, title: event.target.value }
                              : current,
                          )
                        }
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs outline-none focus:border-cyan-400"
                      />
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <label
                            htmlFor={`queue-edit-prompt-${job.id}`}
                            className="text-[10px] text-slate-500"
                          >
                            视频描述
                          </label>
                          <button
                            type="button"
                            disabled={
                              !currentQueueEdit.prompt.trim() ||
                              optimizingPromptContext !== null
                            }
                            onClick={() => void optimizeEditingPrompt(job)}
                            className="text-[10px] text-cyan-300 disabled:opacity-40"
                          >
                            {optimizingPromptContext === job.id
                              ? "AI 优化中…"
                              : "✦ AI 优化"}
                          </button>
                        </div>
                        <textarea
                          id={`queue-edit-prompt-${job.id}`}
                          rows={4}
                          value={currentQueueEdit.prompt}
                          onChange={(event) =>
                            setEditingJob((current) =>
                              current?.id === job.id
                                ? { ...current, prompt: event.target.value }
                                : current,
                            )
                          }
                          className="mt-1 w-full resize-y rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs leading-5 outline-none focus:border-cyan-400"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <select
                          aria-label="内容语言"
                          value={currentQueueEdit.language}
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
                          className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs"
                        >
                          <option value="en">English</option>
                          <option value="zh">中文</option>
                        </select>
                        <select
                          aria-label="视频时长"
                          value={currentQueueEdit.durationSeconds}
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
                          className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs"
                        >
                          {durationOptions.map((duration) => (
                            <option key={duration} value={duration}>
                              {duration} 秒
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <select
                          aria-label="执行日期"
                          value={currentQueueEdit.scheduleDay}
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
                          className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs"
                        >
                          {scheduleDayOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <select
                          aria-label="执行时间"
                          value={currentQueueEdit.scheduleTime}
                          disabled={currentQueueEdit.scheduleDay === "now"}
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
                          className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs disabled:opacity-50"
                        >
                          {scheduleTimeOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingJob(null)}
                          className="rounded-lg border border-slate-700 px-3 py-1.5 text-[11px] text-slate-400"
                        >
                          放弃
                        </button>
                        <button
                          type="button"
                          disabled={
                            isUpdatingQueueJob ||
                            !currentQueueEdit.prompt.trim()
                          }
                          onClick={saveEditingJob}
                          className="rounded-lg bg-cyan-400 px-3 py-1.5 text-[11px] font-semibold text-slate-950 disabled:opacity-45"
                        >
                          {isUpdatingQueueJob ? "保存中…" : "保存修改"}
                        </button>
                      </div>
                    </div>
                  )}

                  {jobActionMessages[job.id] && (
                    <p className="mt-2 text-[10px] text-cyan-300">
                      {jobActionMessages[job.id]}
                    </p>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </aside>
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

function SessionLoadingScreen() {
  return (
    <main className="grid min-h-screen place-items-center bg-slate-950 p-6 text-slate-100">
      <div className="flex items-center gap-3 text-sm text-slate-400">
        <span className="size-2 animate-pulse rounded-full bg-cyan-300" />
        正在检查登录状态…
      </div>
    </main>
  );
}

function LoginScreen({ onSuccess }: { onSuccess: () => void }) {
  const [loginError, setLoginError] = useState<string | null>(null);
  const formElementRef = useRef<HTMLFormElement>(null);
  const form = useForm({
    defaultValues: {
      email: "",
      password: "",
    },
    validators: {
      onChange: mediaHubSignInSchema,
      onSubmit: mediaHubSignInSchema,
    },
    onSubmit: async ({ value }) => {
      setLoginError(null);
      try {
        const result = await authClient.signIn.email({
          email: value.email.trim(),
          password: value.password,
          rememberMe: true,
        });
        if (result.error) {
          setLoginError(
            result.error.message ?? "账号或密码不正确，请检查后重试。",
          );
          return;
        }
        onSuccess();
      } catch (error) {
        setLoginError(
          error instanceof Error ? error.message : "登录失败，请重试。",
        );
      }
    },
  });

  useEffect(() => {
    const syncAutofill = () => {
      const formElement = formElementRef.current;
      const emailInput = formElement?.elements.namedItem("email");
      const passwordInput = formElement?.elements.namedItem("password");

      if (
        emailInput instanceof HTMLInputElement &&
        emailInput.value !== form.getFieldValue("email")
      ) {
        form.setFieldValue("email", emailInput.value);
      }
      if (
        passwordInput instanceof HTMLInputElement &&
        passwordInput.value !== form.getFieldValue("password")
      ) {
        form.setFieldValue("password", passwordInput.value);
      }
    };

    const timers = [0, 100, 500, 1000].map((delay) =>
      window.setTimeout(syncAutofill, delay),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [form]);

  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-slate-950 p-6 text-slate-100">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300 to-transparent" />
      <div className="w-full max-w-md">
        <div className="mb-7">
          <p className="text-xs font-semibold tracking-[0.24em] text-cyan-300">
            PUMPKII MEDIA HUB
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">
            登录视频工作台
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            使用管理员分配的账号登录。视频生成和平台发布仅对已授权成员开放。
          </p>
        </div>
        <form
          ref={formElementRef}
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
          className="relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl shadow-black/30"
        >
          <div className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-cyan-300 via-cyan-500 to-transparent" />
          <form.Field
            name="email"
            children={(field) => {
              const errorMessage = field.state.meta.isTouched
                ? getFormErrorMessage(field.state.meta.errors[0])
                : null;
              return (
                <label className="block text-sm text-slate-300">
                  邮箱
                  <input
                    type="email"
                    name={field.name}
                    autoComplete="username"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onInput={(event) => {
                      setLoginError(null);
                      field.handleChange(event.currentTarget.value);
                    }}
                    onChange={(event) => {
                      setLoginError(null);
                      field.handleChange(event.target.value);
                    }}
                    placeholder="name@pumpkii.com"
                    aria-invalid={!!errorMessage}
                    className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm transition outline-none placeholder:text-slate-600 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/15 aria-invalid:border-rose-400"
                  />
                  {errorMessage && (
                    <span className="mt-1.5 block text-xs text-rose-300">
                      {errorMessage}
                    </span>
                  )}
                </label>
              );
            }}
          />
          <form.Field
            name="password"
            children={(field) => {
              const errorMessage = field.state.meta.isTouched
                ? getFormErrorMessage(field.state.meta.errors[0])
                : null;
              return (
                <label className="mt-4 block text-sm text-slate-300">
                  密码
                  <input
                    type="password"
                    name={field.name}
                    autoComplete="current-password"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onInput={(event) => {
                      setLoginError(null);
                      field.handleChange(event.currentTarget.value);
                    }}
                    onChange={(event) => {
                      setLoginError(null);
                      field.handleChange(event.target.value);
                    }}
                    placeholder="至少 6 位"
                    aria-invalid={!!errorMessage}
                    className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm transition outline-none placeholder:text-slate-600 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/15 aria-invalid:border-rose-400"
                  />
                  {errorMessage && (
                    <span className="mt-1.5 block text-xs text-rose-300">
                      {errorMessage}
                    </span>
                  )}
                </label>
              );
            }}
          />
          {loginError && (
            <p
              role="alert"
              className="mt-4 rounded-xl border border-rose-400/20 bg-rose-400/5 px-3 py-2.5 text-xs leading-5 text-rose-300"
            >
              {loginError}
            </p>
          )}
          <form.Subscribe
            selector={(state) => [state.values, state.isSubmitting] as const}
            children={([values, isSubmitting]) => {
              const isValid = mediaHubSignInSchema.safeParse(values).success;
              return (
                <button
                  type="submit"
                  disabled={!isValid || isSubmitting}
                  className="mt-5 w-full rounded-xl bg-cyan-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 focus-visible:ring-2 focus-visible:ring-cyan-200 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {isSubmitting ? "正在登录…" : "登录后台"}
                </button>
              );
            }}
          />
        </form>
      </div>
    </main>
  );
}

function getFormErrorMessage(error: unknown): string | null {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === "string" ? message : null;
  }
  return null;
}

function PlatformAccountManagementPanel({ isAdmin }: { isAdmin: boolean }) {
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
    ["youtube", "instagram"].includes(account.platform),
  );
  const isStartingOAuth =
    youtubeOAuthMutation.isPending || instagramOAuthMutation.isPending;

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
              youtubeOAuthMutation.mutate({ returnTo: "/" });
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
              使用上方按钮完成 YouTube 或 Instagram 授权。
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
                      className={`rounded-md px-2 py-1 text-[10px] font-semibold tracking-wide uppercase ${
                        account.platform === "youtube"
                          ? "bg-red-400/10 text-red-300"
                          : "bg-fuchsia-400/10 text-fuchsia-300"
                      }`}
                    >
                      {account.platform}
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

function AgentApiManagementPanel() {
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

  const copyToken = async () => {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
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
          <p className="text-xs text-rose-300">{tokenQuery.error.message}</p>
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
                onClick={() => {
                  if (
                    window.confirm(
                      "确认重置你的 Agent API Token？当前用户的旧 Token 会立即失效。",
                    )
                  ) {
                    setMessage(null);
                    resetMutation.mutate();
                  }
                }}
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

function UserManagementPanel({ currentUserId }: { currentUserId: string }) {
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

function StatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = {
    scheduled: "已定时",
    queued: "排队中",
    running: "生成中",
    succeeded: "已完成",
    failed: "失败",
    canceled: "已取消",
  };
  const colors: Record<string, string> = {
    scheduled: "bg-amber-400/10 text-amber-300",
    queued: "bg-slate-700 text-slate-300",
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
