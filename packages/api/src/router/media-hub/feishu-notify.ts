import { Agent, fetch as undiciFetch } from "undici";

import { log } from "@acme/logger";

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

interface GenerationCancellationAlertInput {
  jobId: string;
  title: string | null;
  prompt: string;
  previousStatus: string;
  createdByLabel: string;
  canceledByLabel: string;
  recipientWebhookUrl?: string | null;
}

/** 生成任务被取消时只通知任务创建人配置的 Webhook。 */
export async function sendGenerationCancellationAlert(
  input: GenerationCancellationAlertInput,
): Promise<void> {
  const webhookUrl = input.recipientWebhookUrl?.trim();
  if (!webhookUrl) {
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

  await sendIncomingWebhookCard(webhookUrl, card);
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
}

export type GenerationNotificationDestination =
  | { kind: "user_webhook"; webhookUrl: string }
  | { kind: "disabled" };

export function resolveGenerationNotificationDestination(
  recipientWebhookUrl: string | null | undefined,
): GenerationNotificationDestination {
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
  const webhookUrl = input.recipientWebhookUrl?.trim();
  if (!webhookUrl) {
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
  await sendIncomingWebhookCard(webhookUrl, card);
}
