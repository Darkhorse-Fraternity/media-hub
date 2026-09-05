import { z } from "zod/v4";

// Auth schemas
export const signInByEmailSchema = z.object({
  email: z.email("Please enter a valid email address"),
  password: z
    .string({ message: "Please enter password" })
    .min(1, "Please enter password")
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password cannot exceed 128 characters"),
});

export const mediaHubSignInSchema = z.object({
  email: z.email("请输入有效邮箱"),
  password: z
    .string({ message: "请输入密码" })
    .min(6, "密码至少 6 位")
    .max(128, "密码不能超过 128 位"),
});

// User schemas
export const createUserSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.email("Please enter a valid email address"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password cannot exceed 128 characters"),
  role: z.enum(["admin", "member"]).default("member"),
});

export const updateUserSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  email: z.string().optional(),
  emailVerified: z.boolean().optional(),
  image: z.string().optional(),
  role: z.enum(["admin", "member"]).optional(),
  banned: z.boolean().optional(),
  banReason: z.string().optional(),
  banExpires: z.date().optional(),
});

// Pagination schemas
export const PaginationSchema = z.object({
  pageSize: z.number().optional().default(10),
  pageIndex: z.number().min(0).optional().default(0),
  sorting: z
    .array(
      z.object({
        id: z.string(),
        desc: z.boolean(),
      }),
    )
    .optional(),
  filters: z
    .array(
      z.object({
        id: z.string(),
        value: z.any(),
      }),
    )
    .optional(),
});

export const DateQuerySchema = z.object({
  dateRange: z
    .object({ from: z.date().optional(), to: z.date().optional() })
    .optional(),
});

export const PaginationDateQuerySchema = z.object({
  ...PaginationSchema.shape,
  ...DateQuerySchema.shape,
});

// Invoice schemas
export const updateInvoiceSchema = z.object({
  id: z.string(),
  invoiceCode: z.string().optional(),
  invoiceNumber: z.string().optional(),
  invoiceDate: z.string().optional(),
  invoiceType: z.string().optional(),
  amount: z.number().optional(),
  taxAmount: z.number().optional(),
  totalAmount: z.number().optional(),
  sellerName: z.string().optional(),
  buyerName: z.string().optional(),
  description: z.string().optional(),
  category: z.string().optional(),
  printLandscape: z.boolean().optional(),
  status: z.enum(["pending", "approved", "rejected", "reimbursed"]).optional(),
});

export const invoiceFilterSchema = z.object({
  ...PaginationSchema.shape,
  cursor: z.number().nullish(), // for infinite query (maps to pageIndex)
  month: z.string().optional(), // "YYYY-MM"
  category: z.string().optional(),
  status: z.string().optional(),
});

// Reimbursement schemas
export const createReimbursementSchema = z.object({
  title: z.string().min(1, "标题不能为空"),
  department: z.string().optional(),
  applicant: z.string().optional(),
  period: z.string().min(1, "报销期间不能为空"), // "YYYY-MM"
  notes: z.string().optional(),
});

export const createReimbursementByMonthSchema = z.object({
  period: z.string().min(1), // "YYYY-MM"
  title: z.string().optional(),
  department: z.string().optional(),
  applicant: z.string().optional(),
});

const reportDescriptionSchema = z
  .string()
  .trim()
  .max(100, "报销单摘要不能超过 100 个字符")
  .transform((value) => (value.length > 0 ? value : null))
  .nullable()
  .optional();

export const addReimbursementItemSchema = z.object({
  reimbursementId: z.string(),
  description: z.string().min(1, "描述不能为空"),
  reportDescription: reportDescriptionSchema,
  claimAmount: z.number().min(0),
  invoiceAmount: z.number().optional(),
  category: z.string().optional(),
  expenseDate: z.string().optional(),
  notes: z.string().optional(),
  claimant: z.string().optional(),
  linkInvoiceId: z.string().optional(),
});

export const updateReimbursementItemSchema = z.object({
  id: z.string(),
  description: z.string().optional(),
  reportDescription: reportDescriptionSchema,
  claimAmount: z.number().min(0).optional(),
  invoiceAmount: z.number().nullable().optional(),
  category: z.string().optional(),
  expenseDate: z.string().optional(),
  notes: z.string().optional(),
  claimant: z.string().optional(),
});

export const linkInvoiceSchema = z.object({
  reimbursementItemId: z.string(),
  invoiceId: z.string(),
});

export const unlinkInvoiceSchema = z.object({
  id: z.string(), // reimbursement_item_invoice.id
});

// ===== Media Hub schemas =====

export const mediaPlatformEnum = z.enum(["youtube", "instagram", "tiktok"]);

export const mediaTaskStatusEnum = z.enum([
  "draft",
  "pending_review",
  "approved",
  "rejected",
  "publishing",
  "published",
  "partial_published",
  "failed",
]);

export const mediaPublishTargetStatusEnum = z.enum([
  "pending",
  "publishing",
  "published",
  "failed",
]);

/** 创建媒体任务（草稿） */
export const createMediaTaskSchema = z.object({
  title: z.string().min(1, "标题不能为空").max(200),
  description: z.string().max(5000).optional(),
  hashtags: z.string().max(500).optional(),
  language: z.string().min(2).max(10).default("en"),
  videoStorageKey: z.string().min(1, "视频文件不能为空"),
  coverStorageKey: z.string().optional(),
  aiPrompts: z.record(z.string(), z.unknown()).optional(),
  /** 任务创建时一并指定的发布目标（platform + accountId） */
  targets: z
    .array(
      z.object({
        platform: mediaPlatformEnum,
        accountId: z.string().min(1),
        description: z.string().trim().max(5000).optional(),
      }),
    )
    .min(1, "至少选择一个发布平台"),
});

/** 更新媒体任务（仅草稿状态可改） */
export const updateMediaTaskSchema = z.object({
  id: z.string(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  hashtags: z.string().max(500).optional(),
  language: z.string().min(2).max(10).optional(),
  coverStorageKey: z.string().optional(),
  aiPrompts: z.record(z.string(), z.unknown()).optional(),
});

/** 提交审核 */
export const submitMediaTaskSchema = z.object({
  id: z.string(),
});

/** 审核动作（飞书 callback 或管理员手动） */
export const reviewMediaTaskSchema = z.object({
  id: z.string(),
  action: z.enum(["approve", "reject"]),
  comment: z.string().max(1000).optional(),
});

/** 重试失败的发布 */
export const retryMediaPublishSchema = z.object({
  targetId: z.string(),
});

/** 列表分页 + 过滤 */
export const mediaTaskListQuerySchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  status: mediaTaskStatusEnum.optional(),
  createdBy: z.string().optional(),
});

/** YouTube OAuth 启动 */
export const startYouTubeOAuthSchema = z.object({
  /** 完成后跳回的前端路由 */
  returnTo: z.string().default("/master/media/accounts"),
});

/** YouTube OAuth callback（Google 回调时收到的 code） */
export const youTubeOAuthCallbackSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

/** MinIO 预签名上传 URL 请求 */
export const mediaUploadPresignSchema = z.object({
  /** 'video' | 'cover' */
  kind: z.enum(["video", "cover"]),
  /** 客户端原始文件名，用于推断扩展名 */
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(100),
  /** 文件字节大小，用于校验上限 */
  sizeBytes: z.number().int().positive(),
});

export const mediaGenerationStatusEnum = z.enum([
  "scheduled",
  "queued",
  "waiting_for_gpu",
  "running",
  "succeeded",
  "failed",
  "canceled",
]);

export const mediaContentLanguageEnum = z.enum(["zh", "en"]);
export const mediaH3QualityPresetEnum = z.enum(["fast", "balanced", "quality"]);

/** Agent API、OpenAPI 与内部 tRPC 共用的 H3 请求契约常量。 */
export const MEDIA_H3_PROMPT_MAX_LENGTH = 16_000;
export const MEDIA_H3_DEFAULT_WIDTH = 1344;
export const MEDIA_H3_DEFAULT_HEIGHT = 768;
export const MEDIA_H3_DEFAULT_DURATION_SECONDS = 30;
export const MEDIA_H3_DEFAULT_QUALITY_PRESET = "balanced" as const;

export const mediaH3DimensionSchema = z
  .number()
  .int()
  .min(64)
  .max(1344)
  .refine((value) => value % 32 === 0, "H3 宽高必须是 32 的倍数");

export const mediaH3DialogueSchema = z.object({
  segment: z.number().int().min(1).max(4),
  speakerId: z.enum(["S1", "S2", "S3", "S4"]),
  language: mediaContentLanguageEnum,
  text: z
    .string()
    .trim()
    .min(1, "请输入逐字台词")
    .max(300, "单句台词不能超过 300 个字符")
    .refine(
      (value) => !/[<>]/.test(value),
      "台词不能包含尖括号，H3 标签由系统自动生成",
    ),
});

export type MediaH3Dialogue = z.infer<typeof mediaH3DialogueSchema>;

/** 创建一个 MiniMax H3 图片/文字视频生成任务。 */
export const createMediaGenerationSchema = z.object({
  prompt: z
    .string()
    .trim()
    .min(1, "请输入视频描述")
    .max(MEDIA_H3_PROMPT_MAX_LENGTH),
  language: mediaContentLanguageEnum.default("en"),
  sourceImageStorageKey: z.string().min(1).optional(),
  sourceImageName: z.string().max(255).optional(),
  sourceImageContentType: z
    .enum(["image/jpeg", "image/png", "image/webp"])
    .optional(),
  /** 用户素材库输入；服务端按 session user 解析，客户端不能提交 storage key。 */
  sourceImageAssetId: z.string().min(1).optional(),
  referenceImageAssets: z
    .array(
      z.object({
        assetId: z.string().min(1),
        role: z.enum(["style", "subject"]),
      }),
    )
    .max(4, "最多选择 4 张素材库参考图")
    .default([]),
  referenceImages: z
    .array(
      z.object({
        storageKey: z.string().min(1),
        name: z.string().max(255),
        contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
        role: z.enum(["style", "subject"]),
      }),
    )
    .max(4, "最多上传 4 张风格或主体参考图")
    .default([]),
  title: z.string().trim().max(200).optional(),
  durationSeconds: z
    .number()
    .int()
    .min(5)
    .max(60)
    .default(MEDIA_H3_DEFAULT_DURATION_SECONDS),
  qualityPreset: mediaH3QualityPresetEnum.default(
    MEDIA_H3_DEFAULT_QUALITY_PRESET,
  ),
  /** 可选的单次任务 H3 工作流；留空时由服务端使用管理员默认值。 */
  h3Profile: z.string().trim().min(1).max(200).optional(),
  seed: z.number().int().min(0).max(2_147_483_643).optional(),
  scheduledAt: z.date().nullable().optional(),
  width: mediaH3DimensionSchema.default(MEDIA_H3_DEFAULT_WIDTH),
  height: mediaH3DimensionSchema.default(MEDIA_H3_DEFAULT_HEIGHT),
});

export const mediaImageDimensionSchema = z
  .number()
  .int()
  .min(64)
  .max(4096)
  .refine((value) => value % 32 === 0, "图片宽高必须是 32 的倍数");

export const createMediaImageJobSchema = z.object({
  title: z.string().trim().max(200).optional(),
  prompt: z.string().trim().min(1, "请输入图片描述或修改指令").max(5000),
  negativePrompt: z.string().trim().max(2000).default(""),
  width: mediaImageDimensionSchema.default(1024),
  height: mediaImageDimensionSchema.default(1024),
  seed: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  outputCount: z.number().int().min(1).max(4).default(1),
  diversity: z.number().int().min(0).max(100).default(50),
  inputAssetIds: z.array(z.string().min(1)).max(4).default([]),
});

export const mediaImageIdSchema = z.object({ id: z.string().min(1) });

export const mediaImageListSchema = z.object({
  limit: z.number().int().min(1).max(100).default(50),
});

export const prepareMediaImageVideoInputsSchema = z.object({
  assetIds: z.array(z.string().min(1)).min(1).max(5),
});

const mediaVideoEditReferenceImageSchema = z.object({
  storageKey: z.string().min(1),
  name: z.string().max(255),
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  role: z.enum(["style", "subject"]),
});

export const mediaVideoEditSegmentSchema = z.object({
  id: z.string().min(1).max(100),
  startSeconds: z.number().min(0).max(60),
  endSeconds: z.number().min(0).max(60),
  prompt: z.string().trim().min(1, "请输入该片段的修改描述").max(5000),
  preserveSourceAudio: z.literal(true).default(true),
  referenceImages: z
    .array(mediaVideoEditReferenceImageSchema)
    .max(4, "每个编辑片段最多上传 4 张参考图")
    .default([]),
});

/** 使用 MiniMax H3 Ref2VA 修改已完成视频中的一个或多个时间片段。 */
export const createMediaVideoEditSchema = z
  .object({
    sourceGenerationJobId: z.string().min(1),
    title: z.string().trim().max(200).optional(),
    language: mediaContentLanguageEnum.default("en"),
    segments: z
      .array(mediaVideoEditSegmentSchema)
      .min(1, "至少添加一个修改片段")
      .max(4, "一次最多修改 4 个片段"),
    scheduledAt: z.date().nullable().optional(),
  })
  .superRefine((value, ctx) => {
    const ordered = [...value.segments].sort(
      (left, right) => left.startSeconds - right.startSeconds,
    );
    for (const [index, segment] of ordered.entries()) {
      const duration = segment.endSeconds - segment.startSeconds;
      if (duration < 2 || duration > 15) {
        ctx.addIssue({
          code: "custom",
          path: ["segments", index, "endSeconds"],
          message: "每个 Ref2VA 修改片段必须为 2–15 秒",
        });
      }
      const previous = ordered[index - 1];
      if (previous && segment.startSeconds < previous.endSeconds) {
        ctx.addIssue({
          code: "custom",
          path: ["segments", index, "startSeconds"],
          message: "修改片段不能相互重叠",
        });
      }
    }
  });

export const mediaGenerationListSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  status: mediaGenerationStatusEnum.optional(),
  statuses: z.array(mediaGenerationStatusEnum).min(1).max(7).optional(),
});

export const mediaGenerationIdSchema = z.object({
  id: z.string().min(1),
});

/** 编辑尚未开始执行的 MiniMax H3 生成任务。 */
export const updateMediaGenerationSchema = z.object({
  id: z.string().min(1),
  prompt: z.string().trim().min(1, "请输入视频描述").max(16000),
  language: mediaContentLanguageEnum,
  title: z.string().trim().max(200).nullable().optional(),
  durationSeconds: z.number().int().min(5).max(60),
  qualityPreset: mediaH3QualityPresetEnum,
  scheduledAt: z.date().nullable(),
});

/** 将已生成的视频上传到明确选择的平台账户。 */
export const publishMediaGenerationSchema = z.object({
  id: z.string().min(1),
  targets: z
    .array(
      z.object({
        accountId: z.string().min(1),
        description: z.string().trim().max(5000).optional(),
        title: z.string().trim().max(200).optional(),
        hashtags: z.string().trim().max(500).optional(),
        scheduledAt: z.date().nullable().default(null),
        youtube: z
          .object({
            privacyStatus: z
              .enum(["public", "unlisted", "private"])
              .default("public"),
            categoryId: z.string().regex(/^\d+$/).max(10).default("22"),
            language: z.string().trim().min(2).max(20).default("zh-Hans"),
            madeForKids: z.boolean().default(false),
            containsSyntheticMedia: z.boolean().default(true),
            notifySubscribers: z.boolean().default(true),
          })
          .optional(),
        instagram: z
          .object({
            shareToFeed: z.boolean().default(true),
            thumbOffsetMs: z.number().int().min(0).max(3_600_000).nullable(),
          })
          .optional(),
      }),
    )
    .min(1, "至少选择一个上传账户")
    .max(20)
    .refine(
      (targets) =>
        new Set(targets.map((target) => target.accountId)).size ===
        targets.length,
      "上传账户不能重复",
    ),
});

export const optimizeMediaPromptSchema = z
  .object({
    prompt: z.string().trim().min(1, "请先填写提示词").max(5000),
    language: mediaContentLanguageEnum.default("en"),
    title: z.string().trim().max(200).optional(),
    durationSeconds: z.number().int().min(5).max(60),
    hasReferenceImage: z.boolean().default(false),
    dialogues: z.array(mediaH3DialogueSchema).max(12).default([]),
  })
  .superRefine((input, ctx) => {
    const segmentCount = Math.max(1, Math.ceil(input.durationSeconds / 15));
    input.dialogues.forEach((dialogue, index) => {
      if (dialogue.segment > segmentCount) {
        ctx.addIssue({
          code: "custom",
          path: ["dialogues", index, "segment"],
          message: `${input.durationSeconds} 秒视频只有 ${segmentCount} 个分段`,
        });
      }
    });
  });

export const optimizeMediaImagePromptSchema = z.object({
  prompt: z.string().trim().min(1, "请先填写图片描述或修改指令").max(5000),
  negativePrompt: z.string().trim().max(2000).optional(),
  language: mediaContentLanguageEnum.default("en"),
  title: z.string().trim().max(200).optional(),
  width: mediaImageDimensionSchema,
  height: mediaImageDimensionSchema,
  referenceImageCount: z.number().int().min(0).max(4).default(0),
});

export const optimizeMediaPlatformDescriptionSchema = z.object({
  jobId: z.string().min(1),
  accountId: z.string().min(1),
  currentDescription: z.string().trim().max(5000).optional(),
});
