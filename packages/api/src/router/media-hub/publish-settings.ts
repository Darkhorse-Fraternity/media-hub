export type YouTubePrivacyStatus = "public" | "unlisted" | "private";
export type DouyinPrivateStatus = 0 | 1 | 2;

export interface MediaPublishPlan {
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

type JsonRecord = Record<string, unknown>;

export const defaultMediaPublishPlan: MediaPublishPlan = {
  title: null,
  hashtags: null,
  scheduledAt: null,
  youtube: {
    privacyStatus: "public",
    categoryId: "22",
    language: "en",
    madeForKids: false,
    containsSyntheticMedia: true,
    notifySubscribers: true,
  },
  instagram: {
    shareToFeed: true,
    thumbOffsetMs: null,
  },
  douyin: {
    privateStatus: 0,
    allowDownload: true,
    coverTimeSeconds: null,
  },
};

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function normalizeMediaPublishPlan(value: unknown): MediaPublishPlan {
  const plan = isRecord(value) ? value : {};
  const youtube = isRecord(plan.youtube) ? plan.youtube : {};
  const instagram = isRecord(plan.instagram) ? plan.instagram : {};
  const douyin = isRecord(plan.douyin) ? plan.douyin : {};
  const privacyStatus = ["public", "unlisted", "private"].includes(
    String(youtube.privacyStatus),
  )
    ? (youtube.privacyStatus as YouTubePrivacyStatus)
    : defaultMediaPublishPlan.youtube.privacyStatus;
  const thumbOffsetMs =
    typeof instagram.thumbOffsetMs === "number" &&
    Number.isInteger(instagram.thumbOffsetMs) &&
    instagram.thumbOffsetMs >= 0
      ? instagram.thumbOffsetMs
      : null;
  const privateStatus = [0, 1, 2].includes(Number(douyin.privateStatus))
    ? (Number(douyin.privateStatus) as DouyinPrivateStatus)
    : defaultMediaPublishPlan.douyin.privateStatus;
  const coverTimeSeconds =
    typeof douyin.coverTimeSeconds === "number" &&
    Number.isFinite(douyin.coverTimeSeconds) &&
    douyin.coverTimeSeconds >= 0
      ? douyin.coverTimeSeconds
      : null;

  return {
    title: nullableString(plan.title),
    hashtags: nullableString(plan.hashtags),
    scheduledAt: nullableString(plan.scheduledAt),
    youtube: {
      privacyStatus,
      categoryId:
        nullableString(youtube.categoryId) ??
        defaultMediaPublishPlan.youtube.categoryId,
      language:
        nullableString(youtube.language) ??
        defaultMediaPublishPlan.youtube.language,
      madeForKids: booleanOr(
        youtube.madeForKids,
        defaultMediaPublishPlan.youtube.madeForKids,
      ),
      containsSyntheticMedia: booleanOr(
        youtube.containsSyntheticMedia,
        defaultMediaPublishPlan.youtube.containsSyntheticMedia,
      ),
      notifySubscribers: booleanOr(
        youtube.notifySubscribers,
        defaultMediaPublishPlan.youtube.notifySubscribers,
      ),
    },
    instagram: {
      shareToFeed: booleanOr(
        instagram.shareToFeed,
        defaultMediaPublishPlan.instagram.shareToFeed,
      ),
      thumbOffsetMs,
    },
    douyin: {
      privateStatus,
      allowDownload: booleanOr(
        douyin.allowDownload,
        defaultMediaPublishPlan.douyin.allowDownload,
      ),
      coverTimeSeconds,
    },
  };
}

export function readMediaPublishPlans(
  aiPrompts: unknown,
): Record<string, MediaPublishPlan> {
  if (!isRecord(aiPrompts) || !isRecord(aiPrompts.publishPlans)) return {};
  return Object.fromEntries(
    Object.entries(aiPrompts.publishPlans).map(([accountId, plan]) => [
      accountId,
      normalizeMediaPublishPlan(plan),
    ]),
  );
}

export function writeMediaPublishPlans(
  aiPrompts: unknown,
  plans: Record<string, MediaPublishPlan>,
): JsonRecord {
  return {
    ...(isRecord(aiPrompts) ? aiPrompts : {}),
    publishPlans: plans,
  };
}

export function isMediaPublishPlanDue(
  plan: MediaPublishPlan,
  now = new Date(),
): boolean {
  if (!plan.scheduledAt) return true;
  const scheduledAt = new Date(plan.scheduledAt);
  return (
    !Number.isNaN(scheduledAt.getTime()) &&
    scheduledAt.getTime() <= now.getTime()
  );
}
