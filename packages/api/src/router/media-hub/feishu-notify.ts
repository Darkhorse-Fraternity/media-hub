import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Agent, FormData, fetch as undiciFetch } from "undici";

import { log } from "@acme/logger";

const directDispatcher = new Agent({
  allowH2: false,
  connect: { timeout: 15_000, ALPNProtocols: ["http/1.1"] },
});
const execFileAsync = promisify(execFile);
let cachedTenantAccessToken = "";
let tenantAccessTokenExpiresAt = 0;
const FEISHU_VIDEO_MAX_BYTES = 29_000_000;

async function feishuFetch(url: string, init: RequestInit = {}) {
  const requestInit = {
    ...init,
    dispatcher: directDispatcher,
    signal: init.signal ?? AbortSignal.timeout(15_000),
  } as unknown as Parameters<typeof undiciFetch>[1];
  return (await undiciFetch(url, requestInit)) as unknown as Response;
}

async function getTenantAccessToken(): Promise<string> {
  const appId = process.env.MEDIA_HUB_FEISHU_APP_ID;
  const appSecret = process.env.MEDIA_HUB_FEISHU_APP_SECRET;
  if (!appId || !appSecret) {
    throw new Error(
      "Missing MEDIA_HUB_FEISHU_APP_ID / MEDIA_HUB_FEISHU_APP_SECRET",
    );
  }
  if (cachedTenantAccessToken && Date.now() < tenantAccessTokenExpiresAt) {
    return cachedTenantAccessToken;
  }
  const response = await feishuFetch(
    "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    },
  );
  const payload = (await response.json()) as {
    code: number;
    msg: string;
    tenant_access_token?: string;
    expire?: number;
  };
  if (!response.ok || payload.code !== 0 || !payload.tenant_access_token) {
    throw new Error(
      `Feishu tenant_access_token failed (${payload.code}): ${payload.msg}`,
    );
  }
  cachedTenantAccessToken = payload.tenant_access_token;
  tenantAccessTokenExpiresAt =
    Date.now() + Math.max(60, (payload.expire ?? 7200) - 300) * 1000;
  return cachedTenantAccessToken;
}

function notificationUuid(jobId: string, part: "media" | "card"): string {
  return `${jobId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40)}-${part}`;
}

async function sendAppMessage(input: {
  chatId: string;
  msgType: "interactive" | "media";
  content: string;
  uuid: string;
}): Promise<string> {
  const token = await getTenantAccessToken();
  const response = await feishuFetch(
    "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        receive_id: input.chatId,
        msg_type: input.msgType,
        content: input.content,
        uuid: input.uuid,
      }),
    },
  );
  const payload = (await response.json()) as {
    code: number;
    msg: string;
    data?: { message_id?: string };
  };
  if (!response.ok || payload.code !== 0) {
    throw new Error(
      `Feishu send ${input.msgType} failed (${payload.code}): ${payload.msg}`,
    );
  }
  return payload.data?.message_id ?? input.uuid;
}

async function uploadFeishuVideo(input: {
  video: Buffer;
  fileName: string;
  durationSeconds: number;
}): Promise<string> {
  const token = await getTenantAccessToken();
  const form = new FormData();
  form.append("file_type", "mp4");
  form.append("file_name", input.fileName);
  form.append("duration", String(Math.round(input.durationSeconds * 1000)));
  form.append(
    "file",
    new Blob([new Uint8Array(input.video)], { type: "video/mp4" }),
    input.fileName,
  );
  const response = await feishuFetch(
    "https://open.feishu.cn/open-apis/im/v1/files",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      signal: AbortSignal.timeout(120_000),
    },
  );
  const payload = (await response.json()) as {
    code: number;
    msg: string;
    data?: { file_key?: string };
  };
  const fileKey = payload.data?.file_key;
  if (!response.ok || payload.code !== 0 || !fileKey) {
    throw new Error(
      `Feishu upload video failed (${payload.code}): ${payload.msg}`,
    );
  }
  return fileKey;
}

async function createFeishuVideoThumbnail(
  video: Buffer,
  durationSeconds: number,
): Promise<Buffer> {
  const directory = await mkdtemp(join(tmpdir(), "media-hub-feishu-video-"));
  try {
    const inputPath = join(directory, "video.mp4");
    const outputPath = join(directory, "thumbnail.jpg");
    await writeFile(inputPath, video);
    await execFileAsync(process.env.FFMPEG_PATH ?? "ffmpeg", [
      "-i",
      inputPath,
      "-ss",
      Math.min(1, Math.max(0.1, durationSeconds - 0.1)).toFixed(3),
      "-frames:v",
      "1",
      "-vf",
      "scale=960:960:force_original_aspect_ratio=decrease",
      "-q:v",
      "3",
      outputPath,
      "-y",
      "-loglevel",
      "error",
    ]);
    return await readFile(outputPath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** Keep the native Feishu media upload below its 30 MB boundary. */
export async function prepareFeishuNotificationVideo(
  video: Buffer,
): Promise<Buffer> {
  if (video.length <= FEISHU_VIDEO_MAX_BYTES) return video;

  const directory = await mkdtemp(join(tmpdir(), "media-hub-feishu-compress-"));
  try {
    const inputPath = join(directory, "input.mp4");
    const outputPath = join(directory, "output.mp4");
    await writeFile(inputPath, video);
    await execFileAsync(process.env.FFMPEG_PATH ?? "ffmpeg", [
      "-i",
      inputPath,
      "-vf",
      "scale=720:-2:force_original_aspect_ratio=decrease",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "30",
      "-maxrate",
      "2M",
      "-bufsize",
      "4M",
      "-c:a",
      "aac",
      "-b:a",
      "96k",
      "-movflags",
      "+faststart",
      outputPath,
      "-y",
      "-loglevel",
      "error",
    ]);
    const prepared = await readFile(outputPath);
    if (prepared.length > FEISHU_VIDEO_MAX_BYTES) {
      throw new Error("飞书通知视频压缩后仍超过 30 MB");
    }
    return prepared;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function uploadFeishuImage(image: Buffer): Promise<string> {
  const token = await getTenantAccessToken();
  const form = new FormData();
  form.append("image_type", "message");
  form.append(
    "image",
    new Blob([new Uint8Array(image)], { type: "image/jpeg" }),
    "video-thumbnail.jpg",
  );
  const response = await feishuFetch(
    "https://open.feishu.cn/open-apis/im/v1/images",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      signal: AbortSignal.timeout(30_000),
    },
  );
  const payload = (await response.json()) as {
    code: number;
    msg: string;
    data?: { image_key?: string };
  };
  const imageKey = payload.data?.image_key;
  if (!response.ok || payload.code !== 0 || !imageKey) {
    throw new Error(
      `Feishu upload video thumbnail failed (${payload.code}): ${payload.msg}`,
    );
  }
  return imageKey;
}

export function buildFeishuVideoContent(
  fileKey: string,
  imageKey: string,
): string {
  return JSON.stringify({ file_key: fileKey, image_key: imageKey });
}

async function sendPlayableVideo(input: {
  jobId: string;
  chatId: string;
  video: Buffer;
  fileName: string;
  durationSeconds: number;
}): Promise<void> {
  const thumbnail = await createFeishuVideoThumbnail(
    input.video,
    input.durationSeconds,
  );
  const [fileKey, imageKey] = await Promise.all([
    uploadFeishuVideo(input),
    uploadFeishuImage(thumbnail),
  ]);
  await sendAppMessage({
    chatId: input.chatId,
    msgType: "media",
    content: buildFeishuVideoContent(fileKey, imageKey),
    uuid: notificationUuid(input.jobId, "media"),
  });
}

function safeVideoFileName(label: string): string {
  return `${label.replace(/[\\/:*?"<>|]/g, "-").slice(0, 120)}.mp4`;
}

interface GenerationCancellationAlertInput {
  jobId: string;
  title: string | null;
  prompt: string;
  previousStatus: string;
  createdByLabel: string;
  canceledByLabel: string;
  recipientWebhookUrl?: string | null;
  recipientChatId?: string | null;
}

/** 生成任务被取消时只通知任务创建人配置的 Webhook。 */
export async function sendGenerationCancellationAlert(
  input: GenerationCancellationAlertInput,
): Promise<void> {
  const destination = resolveGenerationNotificationDestination(
    input.recipientChatId,
    input.recipientWebhookUrl,
  );
  if (destination.kind === "disabled") {
    log.info("User Feishu Webhook not set, skipping cancel alert", {
      code: "MEDIA_GENERATION_CANCEL_ALERT_SKIPPED",
      job_id: input.jobId,
    });
    return;
  }

  const trimmedTitle = input.title?.trim();
  const label =
    trimmedTitle && trimmedTitle.length > 0
      ? trimmedTitle
      : input.prompt.slice(0, 80);
  const card = {
    config: { wide_screen_mode: true },
    header: {
      template: "red",
      title: {
        tag: "plain_text",
        content: `⚠️ 视频生成任务已取消：${label}`.slice(0, 100),
      },
    },
    elements: [
      {
        tag: "div",
        fields: [
          {
            is_short: true,
            text: {
              tag: "lark_md",
              content: `**创建人**\n${input.createdByLabel}`,
            },
          },
          {
            is_short: true,
            text: {
              tag: "lark_md",
              content: `**取消人**\n${input.canceledByLabel}`,
            },
          },
          {
            is_short: true,
            text: {
              tag: "lark_md",
              content: `**取消前状态**\n${input.previousStatus}`,
            },
          },
          {
            is_short: true,
            text: {
              tag: "lark_md",
              content: `**任务 ID**\n${input.jobId}`,
            },
          },
        ],
      },
      {
        tag: "div",
        text: {
          tag: "lark_md",
          content: `**提示词**\n${input.prompt.slice(0, 500)}`,
        },
      },
    ],
  };

  if (destination.kind === "app_chat") {
    await sendAppMessage({
      chatId: destination.chatId,
      msgType: "interactive",
      content: JSON.stringify(card),
      uuid: notificationUuid(input.jobId, "card"),
    });
  } else {
    await sendIncomingWebhookCard(destination.webhookUrl, card);
  }
}

export interface GenerationResultCardInput {
  jobId: string;
  title: string | null;
  prompt: string;
  status: "succeeded" | "failed";
  operation?: "generate" | "edit" | "assemble";
  editSegmentCount?: number;
  durationSeconds: number;
  language: string;
  elapsedSeconds: number;
  fps: number;
  width: number;
  height: number;
  qualityPreset?: string;
  steps?: number;
  seed?: number | null;
  profile?: string;
  modelVersion?: string | null;
  workflowVersion?: string | null;
  referenceImageCount: number;
  hasFirstFrame: boolean;
  scheduledAt?: Date | null;
  providerJobId?: string | null;
  videoBytes?: number;
  createdByLabel: string;
  errorMessage?: string | null;
  errorCode?: string | null;
  failureStage?: string | null;
  errorRetryable?: boolean | null;
  videoUrl?: string;
  /** 用户级机器人 Webhook；未配置时不发送。 */
  recipientWebhookUrl?: string | null;
  /** 用户级飞书群；配置后可发送原生可播放视频，优先于 Webhook。 */
  recipientChatId?: string | null;
  video?: Buffer;
}

export type GenerationNotificationDestination =
  | { kind: "app_chat"; chatId: string }
  | { kind: "user_webhook"; webhookUrl: string }
  | { kind: "disabled" };

export function resolveGenerationNotificationDestination(
  recipientChatId: string | null | undefined,
  recipientWebhookUrl: string | null | undefined,
): GenerationNotificationDestination {
  const chatId = recipientChatId?.trim();
  if (chatId) return { kind: "app_chat", chatId };
  const webhookUrl = recipientWebhookUrl?.trim();
  if (webhookUrl) return { kind: "user_webhook", webhookUrl };
  return { kind: "disabled" };
}

async function sendIncomingWebhookCard(
  webhookUrl: string,
  card: Record<string, unknown>,
): Promise<void> {
  if (
    !/^https:\/\/open\.feishu\.cn\/open-apis\/bot\/v2\/hook\/[A-Za-z0-9-]+$/i.test(
      webhookUrl,
    )
  ) {
    throw new Error("Invalid user Feishu Webhook URL");
  }
  const response = await feishuFetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ msg_type: "interactive", card }),
  });
  const payload = (await response.json()) as {
    code?: number;
    msg?: string;
    StatusCode?: number;
    StatusMessage?: string;
  };
  const code = payload.code ?? payload.StatusCode ?? -1;
  if (!response.ok || code !== 0) {
    throw new Error(
      `Feishu user Webhook failed (${code}): ${payload.msg ?? payload.StatusMessage ?? response.statusText}`,
    );
  }
}

function formatElapsedSeconds(seconds: number): string {
  const safeSeconds = Math.max(0, Math.round(seconds));
  if (safeSeconds < 60) return `${safeSeconds} 秒`;
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  return `${minutes} 分 ${remainingSeconds} 秒`;
}

export function buildGenerationResultCard(input: GenerationResultCardInput) {
  const succeeded = input.status === "succeeded";
  const trimmedTitle = input.title?.trim();
  const label =
    trimmedTitle && trimmedTitle.length > 0
      ? trimmedTitle
      : input.prompt.slice(0, 80);
  const elements: Record<string, unknown>[] = [
    {
      tag: "div",
      fields: [
        {
          is_short: true,
          text: {
            tag: "lark_md",
            content: `**创建人**\n${input.createdByLabel}`,
          },
        },
        {
          is_short: true,
          text: {
            tag: "lark_md",
            content: `**视频时长**\n${input.durationSeconds} 秒`,
          },
        },
        {
          is_short: true,
          text: {
            tag: "lark_md",
            content: `**内容语言**\n${input.language === "en" ? "English" : "中文"}`,
          },
        },
        {
          is_short: true,
          text: {
            tag: "lark_md",
            content: `**任务类型**\n${input.operation === "edit" ? `Ref2VA 修改 · ${input.editSegmentCount ?? 0} 个片段` : input.operation === "assemble" ? "脚本镜头合成" : "FL2VA 生成"}`,
          },
        },
        {
          is_short: true,
          text: {
            tag: "lark_md",
            content: `**生成耗时**\n${formatElapsedSeconds(input.elapsedSeconds)}`,
          },
        },
        {
          is_short: true,
          text: { tag: "lark_md", content: `**任务 ID**\n${input.jobId}` },
        },
        {
          is_short: true,
          text: {
            tag: "lark_md",
            content: `**分辨率 / 帧率**\n${input.width} × ${input.height} · ${input.fps} FPS`,
          },
        },
        ...(input.steps
          ? [
              {
                is_short: true,
                text: {
                  tag: "lark_md",
                  content: `**质量 / Seed**\n${input.qualityPreset ?? "custom"} · ${input.steps} 步 · ${input.seed ?? "—"}`,
                },
              },
            ]
          : []),
        {
          is_short: true,
          text: {
            tag: "lark_md",
            content: `**参考图片**\n首帧 ${input.hasFirstFrame ? "1" : "0"} 张 · 其他 ${input.referenceImageCount} 张`,
          },
        },
        ...(input.videoBytes
          ? [
              {
                is_short: true,
                text: {
                  tag: "lark_md",
                  content: `**视频文件**\n${(input.videoBytes / 1_000_000).toFixed(1)} MB · MP4`,
                },
              },
            ]
          : []),
        ...(input.providerJobId
          ? [
              {
                is_short: true,
                text: {
                  tag: "lark_md",
                  content: `**模型 / Provider Job**\nMiniMax H3 · ${input.providerJobId}`,
                },
              },
            ]
          : []),
        ...(input.modelVersion || input.profile
          ? [
              {
                is_short: false,
                text: {
                  tag: "lark_md",
                  content: `**实际模型 / 工作流**\n${input.modelVersion ?? input.profile}${input.workflowVersion ? ` · ${input.workflowVersion}` : ""}`,
                },
              },
            ]
          : []),
        ...(input.scheduledAt
          ? [
              {
                is_short: true,
                text: {
                  tag: "lark_md",
                  content: `**定点执行**\n${input.scheduledAt.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`,
                },
              },
            ]
          : []),
      ],
    },
    {
      tag: "div",
      text: {
        tag: "lark_md",
        content: `**提示词**\n${input.prompt.slice(0, 500)}`,
      },
    },
  ];

  if (!succeeded && input.errorMessage) {
    elements.push({
      tag: "div",
      text: {
        tag: "lark_md",
        content: `**失败原因**\n${input.errorMessage.slice(0, 500)}`,
      },
    });
  }
  if (!succeeded && (input.errorCode || input.failureStage)) {
    elements.push({
      tag: "div",
      fields: [
        {
          is_short: true,
          text: {
            tag: "lark_md",
            content: `**错误码**\n${input.errorCode ?? "unknown"}`,
          },
        },
        {
          is_short: true,
          text: {
            tag: "lark_md",
            content: `**失败阶段 / 可重试**\n${input.failureStage ?? "unknown"} · ${input.errorRetryable ? "是" : "否"}`,
          },
        },
      ],
    });
  }
  if (succeeded && input.videoUrl) {
    elements.push(
      { tag: "hr" },
      {
        tag: "action",
        actions: [
          {
            tag: "button",
            text: { tag: "plain_text", content: "▶ 打开 Media Hub 查看视频" },
            type: "primary",
            url: input.videoUrl,
          },
        ],
      },
    );
  }

  return {
    config: { wide_screen_mode: true },
    header: {
      template: succeeded ? "green" : "red",
      title: {
        tag: "plain_text",
        content:
          `${succeeded ? "🎬 视频生成完成" : "❌ 视频生成失败"}：${label}`.slice(
            0,
            100,
          ),
      },
    },
    elements,
  };
}

/** H3 视频生成进入成功或失败终态后推送飞书通知。 */
export async function sendGenerationResultCard(
  input: GenerationResultCardInput,
): Promise<void> {
  const destination = resolveGenerationNotificationDestination(
    input.recipientChatId,
    input.recipientWebhookUrl,
  );
  if (destination.kind === "disabled") {
    log.info("User Feishu Webhook not set, skipping generation result", {
      code: "MEDIA_GENERATION_RESULT_SKIPPED",
      job_id: input.jobId,
      status: input.status,
    });
    return;
  }

  const card = buildGenerationResultCard(input);
  if (destination.kind === "app_chat") {
    if (input.status === "succeeded" && input.video) {
      await sendPlayableVideo({
        jobId: input.jobId,
        chatId: destination.chatId,
        video: input.video,
        fileName: safeVideoFileName(
          input.title?.trim() || `media-hub-${input.jobId}`,
        ),
        durationSeconds: input.durationSeconds,
      });
    }
    await sendAppMessage({
      chatId: destination.chatId,
      msgType: "interactive",
      content: JSON.stringify(card),
      uuid: notificationUuid(input.jobId, "card"),
    });
    return;
  }
  await sendIncomingWebhookCard(destination.webhookUrl, card);
}

interface PublishResultCardInput {
  taskId: string;
  title: string;
  videoBytes?: number;
  durationSeconds?: number;
  fps?: number;
  width?: number;
  height?: number;
  providerJobId?: string | null;
  recipientWebhookUrl?: string | null;
  recipientChatId?: string | null;
  /** 每个平台的最终结果 */
  targets: {
    platform: string;
    accountLabel?: string | null;
    status: string;
    externalUrl: string | null;
    errorMessage: string | null;
  }[];
}

function formatPublishError(platform: string, errorMessage: string | null) {
  const message = errorMessage ?? "unknown";
  const lower = message.toLowerCase();

  if (
    platform === "youtube" &&
    (lower.includes("token refresh failed") ||
      lower.includes("invalid_grant") ||
      lower.includes("reauthorize required") ||
      lower.includes("no refresh_token"))
  ) {
    return "YouTube 授权已过期或被撤销，请在 Media Hub 的平台账号中重新授权后重试发布。";
  }

  if (
    platform === "instagram" &&
    (lower.includes("token refresh failed") ||
      lower.includes("access token") ||
      lower.includes("reauthorize required"))
  ) {
    return "Instagram 授权已过期或不可用，请在 Media Hub 的平台账号中重新授权后重试发布。";
  }

  return message.slice(0, 200);
}

/** 发布完成（成功 / 失败 / 部分成功）后推通知 */
export async function sendPublishResultCard(
  input: PublishResultCardInput,
): Promise<void> {
  const destination = resolveGenerationNotificationDestination(
    input.recipientChatId,
    input.recipientWebhookUrl,
  );
  if (destination.kind === "disabled") {
    log.info("User Feishu Webhook not set, skipping publish result", {
      code: "MEDIA_PUBLISH_RESULT_SKIPPED",
      task_id: input.taskId,
    });
    return;
  }

  const allOk = input.targets.every((t) => t.status === "published");
  const allFail = input.targets.every((t) => t.status === "failed");
  const headerColor = allOk ? "green" : allFail ? "red" : "yellow";
  const headerEmoji = allOk ? "✅" : allFail ? "❌" : "⚠️";
  const headerLabel = allOk ? "已发布" : allFail ? "全部失败" : "部分成功";

  const lines = input.targets.map((t) => {
    const targetLabel = t.accountLabel
      ? `${t.platform} · ${t.accountLabel}`
      : t.platform;
    if (t.status === "published" && t.externalUrl) {
      return `- **${targetLabel}**：上传成功 · [查看发布](${t.externalUrl})`;
    }
    if (t.status === "failed") {
      return `- **${targetLabel}**：上传失败 — ${formatPublishError(t.platform, t.errorMessage)}`;
    }
    return `- **${targetLabel}**：${t.status}`;
  });

  const card = {
    config: { wide_screen_mode: true },
    header: {
      template: headerColor,
      title: {
        tag: "plain_text",
        content: `${headerEmoji} 平台上传${headerLabel}：${input.title}`.slice(
          0,
          100,
        ),
      },
    },
    elements: [
      ...(input.durationSeconds && input.width && input.height && input.fps
        ? [
            {
              tag: "div",
              fields: [
                {
                  is_short: true,
                  text: {
                    tag: "lark_md",
                    content: `**视频参数**\n${input.durationSeconds} 秒 · ${input.width} × ${input.height} · ${input.fps} FPS`,
                  },
                },
                ...(input.videoBytes
                  ? [
                      {
                        is_short: true,
                        text: {
                          tag: "lark_md",
                          content: `**通知视频**\n${(input.videoBytes / 1_000_000).toFixed(1)} MB · MP4`,
                        },
                      },
                    ]
                  : []),
                ...(input.providerJobId
                  ? [
                      {
                        is_short: true,
                        text: {
                          tag: "lark_md",
                          content: `**模型 / Provider Job**\nMiniMax H3 · ${input.providerJobId}`,
                        },
                      },
                    ]
                  : []),
              ],
            },
          ]
        : []),
      {
        tag: "div",
        text: { tag: "lark_md", content: lines.join("\n") },
      },
    ],
  };
  if (destination.kind === "app_chat") {
    await sendAppMessage({
      chatId: destination.chatId,
      msgType: "interactive",
      content: JSON.stringify(card),
      uuid: notificationUuid(input.taskId, "card"),
    });
  } else {
    await sendIncomingWebhookCard(destination.webhookUrl, card);
  }
}
