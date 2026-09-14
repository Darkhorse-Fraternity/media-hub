import { log } from "@acme/logger";
import { getMediaHubObject } from "@acme/storage";

import { getValidDouyinAccessToken } from "../oauth-token-douyin";
import { buildDouyinText } from "./douyin-copy";

export { buildDouyinText } from "./douyin-copy";

const DOUYIN_UPLOAD_URL =
  "https://open.douyin.com/api/douyin/v1/video/upload_video/";
const DOUYIN_CREATE_URL =
  "https://open.douyin.com/api/douyin/v1/video/create_video/";

interface DouyinApiEnvelope<T> {
  data?: T & { error_code?: number; description?: string };
  extra?: { error_code?: number; description?: string };
}

export interface PublishDouyinInput {
  accountId: string;
  videoStorageKey: string;
  title: string;
  description?: string | null;
  hashtags?: string | null;
  privateStatus?: 0 | 1 | 2;
  allowDownload?: boolean;
  coverTimeSeconds?: number | null;
}

export interface PublishDouyinResult {
  videoId: string;
  url: string;
}

function platformError<T>(
  phase: string,
  response: DouyinApiEnvelope<T>,
): Error {
  const code = response.data?.error_code ?? response.extra?.error_code;
  const message =
    response.data?.description ?? response.extra?.description ?? "未知平台错误";
  return new Error(`抖音${phase}失败（${code ?? "unknown"}）：${message}`);
}

export async function publishToDouyin(
  input: PublishDouyinInput,
): Promise<PublishDouyinResult> {
  const { token, openId } = await getValidDouyinAccessToken(input.accountId);
  const video = await getMediaHubObject(input.videoStorageKey);
  if (video.byteLength > 300 * 1024 * 1024) {
    throw new Error("抖音单文件直传上限为 300MB，请先压缩或接入分片上传");
  }

  const uploadUrl = new URL(DOUYIN_UPLOAD_URL);
  uploadUrl.searchParams.set("open_id", openId);
  const form = new FormData();
  form.set(
    "video",
    new Blob([new Uint8Array(video)], { type: "video/mp4" }),
    "media-hub.mp4",
  );
  const uploadResponse = await fetch(uploadUrl, {
    method: "POST",
    headers: { "access-token": token },
    body: form,
  });
  const uploadBody = (await uploadResponse.json()) as DouyinApiEnvelope<{
    video?: { video_id?: string };
  }>;
  const uploadedVideoId = uploadBody.data?.video?.video_id;
  if (
    !uploadResponse.ok ||
    Number(uploadBody.data?.error_code ?? uploadBody.extra?.error_code ?? 0) !==
      0 ||
    !uploadedVideoId
  ) {
    log.error("Douyin video upload failed", {
      code: "DOUYIN_UPLOAD_FAILED",
      account_id: input.accountId,
      status: uploadResponse.status,
      platform_error_code:
        uploadBody.data?.error_code ?? uploadBody.extra?.error_code,
    });
    throw platformError("视频上传", uploadBody);
  }

  const text = buildDouyinText(input);
  if (Array.from(text).length > 1000) {
    throw new Error("抖音发布文案不能超过 1000 个字符");
  }
  const createUrl = new URL(DOUYIN_CREATE_URL);
  createUrl.searchParams.set("open_id", openId);
  const createResponse = await fetch(createUrl, {
    method: "POST",
    headers: {
      "access-token": token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      video_id: uploadedVideoId,
      text,
      private_status: input.privateStatus ?? 0,
      download_type: input.allowDownload === false ? 1 : 0,
      ...(input.coverTimeSeconds === null ||
      input.coverTimeSeconds === undefined
        ? {}
        : { cover_tsp: input.coverTimeSeconds }),
    }),
  });
  const createBody = (await createResponse.json()) as DouyinApiEnvelope<{
    video_id?: string;
    item_id?: string;
  }>;
  const videoId = createBody.data?.video_id ?? createBody.data?.item_id;
  if (
    !createResponse.ok ||
    Number(createBody.data?.error_code ?? createBody.extra?.error_code ?? 0) !==
      0 ||
    !videoId
  ) {
    log.error("Douyin video creation failed", {
      code: "DOUYIN_CREATE_FAILED",
      account_id: input.accountId,
      status: createResponse.status,
      platform_error_code:
        createBody.data?.error_code ?? createBody.extra?.error_code,
    });
    throw platformError("视频创建", createBody);
  }

  return {
    videoId,
    url: /^\d+$/.test(videoId)
      ? `https://www.douyin.com/video/${videoId}`
      : `https://www.douyin.com/user/${encodeURIComponent(openId)}`,
  };
}
