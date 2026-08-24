import { Readable } from "node:stream";

import { log } from "@acme/logger";
import { getMediaHubObjectStream } from "@acme/storage";

import { getValidYouTubeAccessToken } from "../oauth-token";

const RESUMABLE_INIT_URL =
  "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";

interface PublishYouTubeInput {
  accountId: string;
  videoStorageKey: string;
  title: string;
  description?: string | null;
  hashtags?: string | null;
  language?: string | null;
  privacyStatus?: "public" | "private" | "unlisted";
  categoryId?: string | null;
  madeForKids?: boolean;
  containsSyntheticMedia?: boolean;
  notifySubscribers?: boolean;
  /** ISO UTC 字符串；设置后视频以 private 上传，到时间自动公开 */
  publishAt?: string | null;
}

interface PublishYouTubeResult {
  videoId: string;
  url: string;
}

interface YouTubeVideoResource {
  id: string;
  snippet?: {
    title?: string;
    description?: string;
  };
}

/**
 * 用 resumable upload 把视频从美区 S3 直接 streaming 上传到 YouTube。
 * 不读进内存，避免 1.5GB OOM。
 */
export async function publishToYouTube(
  input: PublishYouTubeInput,
): Promise<PublishYouTubeResult> {
  const accessToken = await getValidYouTubeAccessToken(input.accountId);

  // 1) 拉 S3 视频流（注意 head 也要拿大小，YouTube 推荐声明 X-Upload-Content-Length）
  const s3Stream = await getMediaHubObjectStream(input.videoStorageKey);

  // 解析 hashtags 成 tags 数组（去 #、空格分隔，<= 500 chars total per YouTube spec）
  const tags = (input.hashtags ?? "")
    .split(/[\s,]+/)
    .map((t) => t.replace(/^#/, "").trim())
    .filter(Boolean);

  // 2) Init resumable session
  const metadata = {
    snippet: {
      title: input.title,
      description: input.description ?? "",
      tags: tags.length > 0 ? tags : undefined,
      categoryId: input.categoryId ?? "22",
      defaultLanguage: input.language ?? undefined,
      defaultAudioLanguage: input.language ?? undefined,
    },
    status: {
      // 有定时发布时间：上传为 private，YouTube 到时间自动公开
      privacyStatus: input.publishAt
        ? "private"
        : (input.privacyStatus ?? "public"),
      ...(input.publishAt ? { publishAt: input.publishAt } : {}),
      selfDeclaredMadeForKids: input.madeForKids ?? false,
      containsSyntheticMedia: input.containsSyntheticMedia ?? true,
    },
  };

  const resumableInitUrl = new URL(RESUMABLE_INIT_URL);
  resumableInitUrl.searchParams.set(
    "notifySubscribers",
    String(input.notifySubscribers ?? true),
  );
  const initRes = await fetch(resumableInitUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": "video/*",
    },
    body: JSON.stringify(metadata),
  });
  if (!initRes.ok) {
    const errBody = await initRes.text();
    log.error("YouTube resumable init failed", {
      code: "YT_RESUMABLE_INIT_FAILED",
      account_id: input.accountId,
      status: initRes.status,
      body: errBody,
    });
    throw new Error(
      `YouTube resumable init failed (HTTP ${initRes.status}): ${errBody.slice(0, 200)}`,
    );
  }
  const uploadUrl = initRes.headers.get("location");
  if (!uploadUrl) {
    throw new Error("YouTube did not return upload URL in Location header");
  }

  // 3) PUT 流到 upload URL
  // Node fetch 接受 Web ReadableStream 作为 body；从 Node Readable 转一下。
  const webStream = Readable.toWeb(
    s3Stream instanceof Readable ? s3Stream : Readable.from(s3Stream),
  );

  const uploadInit = {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "video/*",
    },
    duplex: "half",
    body: webStream,
  } as unknown as RequestInit;

  const uploadRes = await fetch(uploadUrl, uploadInit);
  if (!uploadRes.ok) {
    const errBody = await uploadRes.text();
    log.error("YouTube upload failed", {
      code: "YT_UPLOAD_FAILED",
      account_id: input.accountId,
      status: uploadRes.status,
      body: errBody,
    });
    throw new Error(
      `YouTube upload failed (HTTP ${uploadRes.status}): ${errBody.slice(0, 200)}`,
    );
  }
  const video = (await uploadRes.json()) as YouTubeVideoResource;
  if (!video.id) {
    throw new Error("YouTube response missing video id");
  }

  return {
    videoId: video.id,
    url: `https://www.youtube.com/watch?v=${video.id}`,
  };
}
