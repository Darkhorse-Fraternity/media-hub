import {
  bigint,
  boolean,
  index,
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

export interface MediaVideoScriptDialogue {
  id: string;
  atSeconds: number;
  speakerId: "S1" | "S2" | "S3" | "S4";
  language: "zh" | "en";
  text: string;
}

export interface MediaVideoScriptContinuityBible {
  characters: string;
  wardrobeAndProps: string;
  locationsAndLighting: string;
  visualRules: string;
}

export interface MediaVideoScriptShot {
  id: string;
  title: string;
  durationSeconds: number;
  visualDescription: string;
  cameraDirection: string;
  continuity: string;
  soundscape: string;
  music: string;
  dialogues: MediaVideoScriptDialogue[];
  firstFrameAssetId?: string;
}

/** 当前用户在 Media Hub 中跨设备同步的默认操作偏好。 */
export const mediaUserPreference = pgTable("media_user_preference", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  contentLanguage: text("content_language").notNull().default("en"),
  durationSeconds: integer("duration_seconds").notNull().default(30),
  resolution: text("resolution").notNull().default("1344x768"),
  youtubePrivacyStatus: text("youtube_privacy_status")
    .notNull()
    .default("public"),
  youtubeCategoryId: text("youtube_category_id").notNull().default("22"),
  youtubeNotifySubscribers: boolean("youtube_notify_subscribers")
    .notNull()
    .default(true),
  instagramShareToFeed: boolean("instagram_share_to_feed")
    .notNull()
    .default(true),
  /** 该用户的通知地址；留空时不发送任何飞书通知。 */
  feishuWebhookUrl: text("feishu_webhook_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/**
 * 可在线修改的部署策略。这里只保存允许热更新的非根密钥配置；数据库、
 * 身份认证、对象存储和 OAuth 应用密钥仍由部署环境负责。
 */
export const mediaSystemSetting = pgTable("media_system_setting", {
  id: text("id").primaryKey(),
  /** Provider 注册的默认 H3 生成 profile；为空时使用部署默认值。 */
  h3GenerationProfile: text("h3_generation_profile"),
  /** Provider 注册的默认 H3 编辑 profile；为空时使用部署默认值。 */
  h3EditProfile: text("h3_edit_profile"),
  codexWorkerUrl: text("codex_worker_url"),
  codexWorkerSource: text("codex_worker_source"),
  codexTimeoutMs: integer("codex_timeout_ms").notNull().default(180000),
  ollamaBaseUrl: text("ollama_base_url"),
  ollamaModel: text("ollama_model").notNull().default("qwen3-vl:32b"),
  /** @deprecated 保留旧列以避免破坏性迁移；通知不再读取全局群配置。 */
  feishuReviewChatId: text("feishu_review_chat_id"),
  updatedBy: text("updated_by").references(() => user.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

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

/** 用户私有的视频脚本；镜头作为有稳定 ID 的版本化 JSON 文档保存。 */
export const mediaVideoScript = pgTable(
  "media_video_script",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    brief: text("brief").notNull(),
    language: text("language").notNull().default("zh"),
    width: integer("width").notNull().default(1344),
    height: integer("height").notNull().default(768),
    defaultProfile: text("default_profile"),
    continuityBible: jsonb("continuity_bible")
      .$type<MediaVideoScriptContinuityBible>()
      .notNull()
      .default({
        characters: "",
        wardrobeAndProps: "",
        locationsAndLighting: "",
        visualRules: "",
      }),
    shots: jsonb("shots").$type<MediaVideoScriptShot[]>().notNull().default([]),
    /** draft | ready | production */
    status: text("status").notNull().default("draft"),
    /** 乐观锁版本；每次修改完整脚本文档时递增。 */
    version: integer("version").notNull().default(1),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"),
  },
  (table) => [
    index("media_video_script_owner_updated_idx").on(
      table.createdBy,
      table.updatedAt,
    ),
  ],
);

/**
 * H3 视频生成任务。生成和发布是两条独立链路：生成完成后先落到 S3，
 * 再创建一个 draft media_task，管理员可以检查后提交发布审核。
 */
export const mediaGenerationJob = pgTable(
  "media_generation_job",
  {
    id: text("id").primaryKey(),
    scriptId: text("script_id").references(() => mediaVideoScript.id, {
      onDelete: "set null",
    }),
    /** 脚本文档内的稳定镜头 ID；任务 Prompt 本身仍是不可变快照。 */
    scriptShotId: text("script_shot_id"),
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
    preserveSourceAudio: boolean("preserve_source_audio")
      .notNull()
      .default(true),
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
    /** 从用户图片素材库选择的资产 ID；只用于引用保护和审计。 */
    inputImageAssetIds: jsonb("input_image_asset_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    /** 目标时长；H3 单段最长约 15 秒，后台会拼接多段达到目标时长。 */
    durationSeconds: integer("duration_seconds").notNull().default(30),
    fps: integer("fps").notNull().default(24),
    width: integer("width").notNull().default(1344),
    height: integer("height").notNull().default(768),
    /** fast=4 steps, balanced=6 steps, quality=8 steps; edit jobs use edit. */
    qualityPreset: text("quality_preset").notNull().default("balanced"),
    steps: integer("steps").notNull().default(6),
    /** Reproducible base seed; later H3 segments increment this value. */
    seed: bigint("seed", { mode: "number" }),
    profile: text("profile").notNull().default("platform-h3-i2v-inline-v1"),
    workflowVersion: text("workflow_version"),
    modelVersion: text("model_version"),
    /** scheduled|queued|waiting_for_gpu|running|succeeded|failed|canceled */
    status: text("status").notNull().default("queued"),
    scheduledAt: timestamp("scheduled_at"),
    providerJobId: text("provider_job_id"),
    outputStorageKey: text("output_storage_key"),
    mediaTaskId: text("media_task_id").references(() => mediaTask.id, {
      onDelete: "set null",
    }),
    errorMessage: text("error_message"),
    /** Provider/质检可机读失败码，例如 gpu_out_of_memory。 */
    errorCode: text("error_code"),
    /** provider_backend | provider_execution | output_validation | orchestration */
    failureStage: text("failure_stage"),
    /** 是否适合在资源或链路恢复后原参数重试。 */
    errorRetryable: boolean("error_retryable"),
    /** gpu-resource-broker 的幂等请求与当前租约，用于重启续跑和审计。 */
    gpuBrokerRequestId: text("gpu_broker_request_id"),
    gpuBrokerLeaseId: text("gpu_broker_lease_id"),
    /** H3 原始音轨的只读 ASR 验收结果；不会替换原声音轨。 */
    asrTranscript: text("asr_transcript"),
    asrMatchPercent: integer("asr_match_percent"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("media_generation_job_script_shot_idx").on(
      table.scriptId,
      table.scriptShotId,
    ),
  ],
);

/** HiDream 图片生成/修改任务；图片和视频任务保持独立语义。 */
export const mediaImageJob = pgTable(
  "media_image_job",
  {
    id: text("id").primaryKey(),
    /** generate | edit */
    kind: text("kind").notNull().default("generate"),
    title: text("title"),
    prompt: text("prompt").notNull(),
    negativePrompt: text("negative_prompt").notNull().default(""),
    width: integer("width").notNull().default(1024),
    height: integer("height").notNull().default(1024),
    seed: bigint("seed", { mode: "number" }),
    outputCount: integer("output_count").notNull().default(1),
    diversity: integer("diversity").notNull().default(50),
    profile: text("profile").notNull().default("platform-hidream-o1-image-v1"),
    workflowVersion: text("workflow_version"),
    modelVersion: text("model_version"),
    /** queued|running|succeeded|failed|canceled */
    status: text("status").notNull().default("queued"),
    providerJobId: text("provider_job_id"),
    errorMessage: text("error_message"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("media_image_job_owner_created_idx").on(
      table.createdBy,
      table.createdAt,
    ),
  ],
);

/** 用户私有图片素材；ownerUserId 是普通素材 API 的强制授权边界。 */
export const mediaImageAsset = pgTable(
  "media_image_asset",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id").references(() => mediaImageJob.id, {
      onDelete: "set null",
    }),
    storageKey: text("storage_key").notNull(),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    width: integer("width"),
    height: integer("height"),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    checksum: text("checksum").notNull(),
    /** upload | generated | video-frame */
    origin: text("origin").notNull(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    deletedAt: timestamp("deleted_at"),
  },
  (table) => [
    index("media_image_asset_owner_created_idx").on(
      table.ownerUserId,
      table.createdAt,
    ),
    uniqueIndex("media_image_asset_storage_key_uidx").on(table.storageKey),
  ],
);

/** 图片修改任务的有序输入资产；任务和资产 owner 在服务端创建时强校验一致。 */
export const mediaImageJobInput = pgTable(
  "media_image_job_input",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => mediaImageJob.id, { onDelete: "cascade" }),
    assetId: text("asset_id")
      .notNull()
      .references(() => mediaImageAsset.id, { onDelete: "restrict" }),
    position: integer("position").notNull(),
    role: text("role").notNull().default("reference"),
  },
  (table) => [
    uniqueIndex("media_image_job_input_position_uidx").on(
      table.jobId,
      table.position,
    ),
  ],
);

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
