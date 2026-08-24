import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Agent, FormData, fetch as undiciFetch } from "undici";

import { log } from "@acme/logger";

/**
 * Media Hub 专属飞书通知出口。
 * 独立飞书应用（独立 App ID / Secret / Chat），与 alert-bot 完全隔离。
 */

let cachedToken = "";
let tokenExpiresAt = 0;
const execFileAsync = promisify(execFile);
const directDispatcher = new Agent({
  allowH2: false,
  connect: { timeout: 15_000, ALPNProtocols: ["http/1.1"] },
});

async function feishuFetch(url: string, init: RequestInit = {}) {
  const requestInit = {
    ...init,
    dispatcher: directDispatcher,
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
  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }
  const res = await feishuFetch(
    "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    },
  );
  const data = (await res.json()) as {
    code: number;
    msg: string;
    tenant_access_token: string;
    expire: number;
  };
  if (data.code !== 0) {
    throw new Error(`Feishu tenant_access_token failed: ${data.msg}`);
  }
  cachedToken = data.tenant_access_token;
  tokenExpiresAt = Date.now() + (data.expire - 300) * 1000;
  return cachedToken;
}

interface SendCardOptions {
  /** chat_id (oc_xxx) — 必填 */
  chatId: string;
  /** 卡片 JSON（飞书 v1 格式 string） */
  cardJson: string;
}

interface SendMessageOptions {
  chatId: string;
  msgType: "interactive" | "media";
  content: string;
}

async function sendMessage({
  chatId,
  msgType,
  content,
}: SendMessageOptions): Promise<void> {
  const token = await getTenantAccessToken();
  const res = await feishuFetch(
    "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ receive_id: chatId, msg_type: msgType, content }),
    },
  );
  const json = (await res.json()) as { code: number; msg: string };
  if (json.code !== 0) {
    throw new Error(`Feishu send ${msgType} failed: ${json.msg}`);
  }
}

async function sendCard({ chatId, cardJson }: SendCardOptions): Promise<void> {
  await sendMessage({ chatId, msgType: "interactive", content: cardJson });
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
  const res = await feishuFetch(
    "https://open.feishu.cn/open-apis/im/v1/files",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    },
  );
  const json = (await res.json()) as {
    code: number;
    msg: string;
    data?: { file_key?: string };
  };
  const fileKey = json.data?.file_key;
  if (json.code !== 0 || !fileKey) {
    const logId = res.headers.get("x-tt-logid") ?? "unknown-log-id";
    throw new Error(
      `Feishu upload video failed (${json.code}, ${logId}): ${json.msg}`,
    );
  }
  return fileKey;
}

async function createFeishuVideoThumbnail(
  video: Buffer,
  durationSeconds: number,
): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "media-hub-feishu-thumbnail-"));
  try {
    const inputPath = join(dir, "video.mp4");
    const outputPath = join(dir, "thumbnail.jpg");
    const thumbnailSecond = Math.min(1, Math.max(0.1, durationSeconds - 0.1));
    await writeFile(inputPath, video);
    await execFileAsync(process.env.FFMPEG_PATH ?? "ffmpeg", [
      "-i",
      inputPath,
      "-ss",
      thumbnailSecond.toFixed(3),
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
    await rm(dir, { recursive: true, force: true });
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
  const res = await feishuFetch(
    "https://open.feishu.cn/open-apis/im/v1/images",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    },
  );
  const json = (await res.json()) as {
    code: number;
    msg: string;
    data?: { image_key?: string };
  };
  const imageKey = json.data?.image_key;
  if (json.code !== 0 || !imageKey) {
    const logId = res.headers.get("x-tt-logid") ?? "unknown-log-id";
    throw new Error(
      `Feishu upload video thumbnail failed (${json.code}, ${logId}): ${json.msg}`,
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
  await sendMessage({
    chatId: input.chatId,
    msgType: "media",
    content: buildFeishuVideoContent(fileKey, imageKey),
  });
}

function safeVideoFileName(label: string): string {
  return `${label.replace(/[\\/:*?"<>|]/g, "-").slice(0, 120)}.mp4`;
}

function normalizeUnknownError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === "string") return new Error(error);
  return new Error("Unknown Feishu media notification error");
}

/** 直接向审核群发送任意卡片（供定时报告等场景使用） */
export async function sendToReviewChat(cardJson: string): Promise<void> {
  const chatId = process.env.MEDIA_HUB_REVIEW_CHAT_ID;
  if (!chatId) {
    throw new Error("MEDIA_HUB_REVIEW_CHAT_ID not set");
  }
  await sendCard({ chatId, cardJson });
}

interface GenerationCancellationAlertInput {
  jobId: string;
  title: string | null;
  prompt: string;
  previousStatus: string;
  createdByLabel: string;
  canceledByLabel: string;
}

/** 生成任务被取消时向审核群报警；未配置群时只保留后端审计日志。 */
export async function sendGenerationCancellationAlert(
  input: GenerationCancellationAlertInput,
): Promise<void> {
  const chatId = process.env.MEDIA_HUB_REVIEW_CHAT_ID;
  if (!chatId) {
    log.warn("MEDIA_HUB_REVIEW_CHAT_ID not set, skipping cancel alert", {
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

  await sendCard({ chatId, cardJson: JSON.stringify(card) });
}

export interface GenerationResultCardInput {
  jobId: string;
  title: string | null;
  prompt: string;
  status: "succeeded" | "failed";
  operation?: "generate" | "edit";
  editSegmentCount?: number;
  durationSeconds: number;
  language: string;
  elapsedSeconds: number;
  fps: number;
  width: number;
  height: number;
  referenceImageCount: number;
  hasFirstFrame: boolean;
  scheduledAt?: Date | null;
  providerJobId?: string | null;
  videoBytes?: number;
  createdByLabel: string;
  errorMessage?: string | null;
  videoUrl?: string;
  video?: Buffer;
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
            content: `**任务类型**\n${input.operation === "edit" ? `Ref2VA 修改 · ${input.editSegmentCount ?? 0} 个片段` : "FL2VA 生成"}`,
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
  const chatId = process.env.MEDIA_HUB_REVIEW_CHAT_ID;
  if (!chatId) {
    log.warn("MEDIA_HUB_REVIEW_CHAT_ID not set, skipping generation result", {
      code: "MEDIA_GENERATION_RESULT_SKIPPED",
      job_id: input.jobId,
      status: input.status,
    });
    return;
  }
  let mediaError: unknown;
  if (input.status === "succeeded" && input.video) {
    try {
      await sendPlayableVideo({
        chatId,
        video: input.video,
        fileName: safeVideoFileName(
          input.title?.trim() ?? `media-hub-${input.jobId}`,
        ),
        durationSeconds: input.durationSeconds,
      });
    } catch (error) {
      mediaError = error;
    }
  }

  await sendCard({
    chatId,
    cardJson: JSON.stringify(buildGenerationResultCard(input)),
  });
  if (mediaError) {
    throw normalizeUnknownError(mediaError);
  }
}

interface PublishResultCardInput {
  taskId: string;
  title: string;
  video?: Buffer;
  videoBytes?: number;
  durationSeconds?: number;
  fps?: number;
  width?: number;
  height?: number;
  providerJobId?: string | null;
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
  const chatId = process.env.MEDIA_HUB_REVIEW_CHAT_ID;
  if (!chatId) {
    log.warn("MEDIA_HUB_REVIEW_CHAT_ID not set, skipping publish result", {
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
  let mediaError: unknown;
  if (input.video && input.durationSeconds) {
    try {
      await sendPlayableVideo({
        chatId,
        video: input.video,
        fileName: safeVideoFileName(input.title),
        durationSeconds: input.durationSeconds,
      });
    } catch (error) {
      mediaError = error;
    }
  }
  await sendCard({ chatId, cardJson: JSON.stringify(card) });
  if (mediaError) {
    throw normalizeUnknownError(mediaError);
  }
}
