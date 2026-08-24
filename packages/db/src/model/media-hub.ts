import {
  bigint,
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "../auth-schema";

export interface MediaGenerationReferenceImage {
  storageKey: string;
  name: string;
  contentType: "image/jpeg" | "image/png" | "image/webp";
  role: "style" | "subject";
}

export interface MediaVideoEditSegment {
  id: string;
  startSeconds: number;
  endSeconds: number;
  prompt: string;
  preserveSourceAudio: boolean;
  referenceImages: MediaGenerationReferenceImage[];
}

/**
 * 平台账号（OAuth 凭证）
 * 一个平台可以有多个账号（未来扩展）；access/refresh token 加密后再写入。
 */
export const mediaPlatformAccount = pgTable("media_platform_account", {
  id: text("id").primaryKey(),
  /** 'youtube' | 'instagram' | 'tiktok' */
  platform: text("platform").notNull(),
  /** 人可读的账号标签，例：Pumpkii Official YouTube */
  accountLabel: text("account_label").notNull(),
  /** 平台原始账号 ID（YouTube Channel ID / IG Business Account ID / TikTok Open ID） */
  externalAccountId: text("external_account_id").notNull(),
  /** 加密后的 access_token */
  accessTokenEnc: text("access_token_enc").notNull(),
  /** 加密后的 refresh_token */
  refreshTokenEnc: text("refresh_token_enc"),
  tokenExpiresAt: timestamp("token_expires_at"),
  /** 逗号分隔，例：youtube.upload,youtube.readonly */
  scopes: text("scopes").notNull(),
  createdBy: text("created_by")
    .notNull()
    .references(() => user.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/**
 * 媒体任务（一条视频从草稿到发布的核心单元）
 * 一个 task 可以发到多个平台，平台级别状态在 media_publish_target。
 */
export const mediaTask = pgTable("media_task", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  /** 逗号分隔；YouTube 不用，IG/TikTok 会用 */
  hashtags: text("hashtags"),
  /** 'en' | 'zh' | ... ，用于 YouTube defaultLanguage */
  language: text("language").notNull().default("en"),
  /** MinIO object key，原始视频文件 */
  videoStorageKey: text("video_storage_key").notNull(),
  /** MinIO object key，封面图（可选） */
  coverStorageKey: text("cover_storage_key"),
  /** AI 生成提示词归档（脚本 / 分镜 / 文案 prompt 都进这） */
  aiPrompts: jsonb("ai_prompts"),
  /** draft|pending_review|approved|rejected|publishing|published|partial_published|failed */
  status: text("status").notNull().default("draft"),
  createdBy: text("created_by")
    .notNull()
    .references(() => user.id, { onDelete: "restrict" }),
  reviewedBy: text("reviewed_by").references(() => user.id, {
    onDelete: "set null",
  }),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/**
 * H3 视频生成任务。生成和发布是两条独立链路：生成完成后先落到 S3，
 * 再创建一个 draft media_task，管理员可以检查后提交发布审核。
 */
export const mediaGenerationJob = pgTable("media_generation_job", {
  id: text("id").primaryKey(),
  /** generate | edit；编辑任务和生成任务共用同一个可见队列。 */
  kind: text("kind").notNull().default("generate"),
  /** 编辑任务的源成片任务 ID；源文件仍通过源任务的 MinIO key 获取。 */
  sourceGenerationJobId: text("source_generation_job_id"),
  /** Ref2VA 时间轴编辑片段，按开始时间排序且不可重叠。 */
  editSegments: jsonb("edit_segments")
    .$type<MediaVideoEditSegment[]>()
    .notNull()
    .default([]),
  /** 多片段编辑会产生多个 Provider 子任务。 */
  providerJobIds: jsonb("provider_job_ids")
    .$type<string[]>()
    .notNull()
    .default([]),
  /** 编辑输出默认复用源视频音轨，防止意外生成背景人声。 */
  preserveSourceAudio: boolean("preserve_source_audio").notNull().default(true),
  prompt: text("prompt").notNull(),
  title: text("title"),
  /** 'zh' | 'en'，控制视频提示词和平台发布文案的输出语言。 */
  language: text("language").notNull().default("zh"),
  sourceImageStorageKey: text("source_image_storage_key"),
  sourceImageName: text("source_image_name"),
  sourceImageContentType: text("source_image_content_type"),
  /** 额外的风格/主体参考图；首帧继续使用 source_image_* 字段。 */
  referenceImages: jsonb("reference_images")
    .$type<MediaGenerationReferenceImage[]>()
    .notNull()
    .default([]),
  /** 目标时长；H3 单段最长约 15 秒，后台会拼接多段达到目标时长。 */
  durationSeconds: integer("duration_seconds").notNull().default(30),
  fps: integer("fps").notNull().default(24),
  width: integer("width").notNull().default(960),
  height: integer("height").notNull().default(544),
  /** scheduled|queued|running|succeeded|failed|canceled */
  status: text("status").notNull().default("queued"),
  scheduledAt: timestamp("scheduled_at"),
  providerJobId: text("provider_job_id"),
  outputStorageKey: text("output_storage_key"),
  mediaTaskId: text("media_task_id").references(() => mediaTask.id, {
    onDelete: "set null",
  }),
  errorMessage: text("error_message"),
  createdBy: text("created_by")
    .notNull()
    .references(() => user.id, { onDelete: "restrict" }),
  startedAt: timestamp("started_at"),
  finishedAt: timestamp("finished_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/** Media Hub Agent API 的用户 Bearer Token；密文用于本人查看，哈希用于请求鉴权。 */
export const mediaApiToken = pgTable(
  "media_api_token",
  {
    id: text("id").primaryKey(),
    label: text("label").notNull().default("Media Hub Agent API"),
    tokenHash: text("token_hash").notNull(),
    tokenEnc: text("token_enc").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    lastUsedAt: timestamp("last_used_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [uniqueIndex("media_api_token_hash_uidx").on(table.tokenHash)],
);

/**
 * 平台发布目标（每个 task × 每个平台一行）
 * status 是平台维度的，task.status 是聚合维度的。
 */
export const mediaPublishTarget = pgTable("media_publish_target", {
  id: text("id").primaryKey(),
  taskId: text("task_id")
    .notNull()
    .references(() => mediaTask.id, { onDelete: "cascade" }),
  /** 'youtube' | 'instagram' | 'tiktok' */
  platform: text("platform").notNull(),
  accountId: text("account_id")
    .notNull()
    .references(() => mediaPlatformAccount.id, { onDelete: "restrict" }),
  /** 针对当前平台账号的发布文案；为空时回退到 media_task.description。 */
  description: text("description"),
  /** pending|publishing|published|failed */
  status: text("status").notNull().default("pending"),
  /** 平台返回的视频/帖子 ID（YouTube videoId / IG media ID / TikTok publish_id） */
  externalPostId: text("external_post_id"),
  /** 平台公开 URL */
  externalUrl: text("external_url"),
  publishedAt: timestamp("published_at"),
  errorMessage: text("error_message"),
  retryCount: integer("retry_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/**
 * 每日平台数据快照（每天拉一次 YouTube/IG/TikTok 统计数据存档）
 * 用于每日报告和增长趋势分析。
 */
export const mediaPlatformStats = pgTable(
  "media_platform_stats",
  {
    id: text("id").primaryKey(),
    /** 'youtube' | 'instagram' | 'tiktok' */
    platform: text("platform").notNull(),
    accountId: text("account_id")
      .notNull()
      .references(() => mediaPlatformAccount.id, { onDelete: "cascade" }),
    /** YouTube videoId / IG mediaId / TikTok item_id */
    externalVideoId: text("external_video_id").notNull(),
    /** 视频标题快照 */
    videoTitle: text("video_title"),
    viewCount: bigint("view_count", { mode: "number" }).notNull().default(0),
    likeCount: bigint("like_count", { mode: "number" }).notNull().default(0),
    commentCount: bigint("comment_count", { mode: "number" })
      .notNull()
      .default(0),
    /** YYYY-MM-DD，每天最多写一行（ON CONFLICT DO UPDATE） */
    snapshotDate: text("snapshot_date").notNull(),
    fetchedAt: timestamp("fetched_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("mps_video_date_uidx").on(t.externalVideoId, t.snapshotDate),
  ],
);

/**
 * 审核动作日志（飞书审核卡片的每次点击都写一条）
 */
export const mediaReviewLog = pgTable("media_review_log", {
  id: text("id").primaryKey(),
  taskId: text("task_id")
    .notNull()
    .references(() => mediaTask.id, { onDelete: "cascade" }),
  reviewer: text("reviewer")
    .notNull()
    .references(() => user.id, { onDelete: "restrict" }),
  /** submit|approve|reject|retry */
  action: text("action").notNull(),
  comment: text("comment"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
