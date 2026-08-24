import type { DeleteObjectCommandInput } from "@aws-sdk/client-s3";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Lazy-initialized singleton
let s3Client: S3Client | null = null;

function getClient(): S3Client {
  if (!s3Client) {
    const rawEndpoint = process.env.MINIO_ENDPOINT;
    const port = process.env.MINIO_PORT;
    const useSsl = process.env.MINIO_USE_SSL === "true";
    const accessKey = process.env.MINIO_ACCESS_KEY;
    const secretKey = process.env.MINIO_SECRET_KEY;
    const region = process.env.MINIO_REGION ?? "us-east-1";

    if (!rawEndpoint || !accessKey || !secretKey) {
      throw new Error(
        "Missing MINIO_ENDPOINT, MINIO_ACCESS_KEY, or MINIO_SECRET_KEY",
      );
    }

    // MINIO_ENDPOINT 允许两种写法：
    //   1) 完整 URL: "https://minio.example.com"
    //   2) 裸 host: "minio.example.com"（搭配 MINIO_PORT 和 MINIO_USE_SSL）
    const endpoint = /^https?:\/\//.test(rawEndpoint)
      ? rawEndpoint
      : `${useSsl ? "https" : "http"}://${rawEndpoint}${port ? `:${port}` : ""}`;

    s3Client = new S3Client({
      endpoint,
      region,
      credentials: {
        accessKeyId: accessKey,
        secretAccessKey: secretKey,
      },
      forcePathStyle: true, // Required for MinIO
    });
  }
  return s3Client;
}

function getBucket(): string {
  const bucket = process.env.MINIO_BUCKET;
  if (!bucket) {
    throw new Error("Missing MINIO_BUCKET environment variable");
  }
  return bucket;
}

export async function getPresignedUploadUrl(
  key: string,
  contentType: string,
  expiresIn = 3600,
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: getBucket(),
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(getClient(), command, { expiresIn });
}

export async function getPresignedDownloadUrl(
  key: string,
  expiresIn = 3600,
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: getBucket(),
    Key: key,
  });
  return getSignedUrl(getClient(), command, { expiresIn });
}

export async function putObject(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string,
): Promise<void> {
  const command = new PutObjectCommand({
    Bucket: getBucket(),
    Key: key,
    Body: body,
    ContentType: contentType,
    ContentLength: body.length,
  });
  await getClient().send(command);
}

export async function getObject(key: string): Promise<Buffer> {
  const command = new GetObjectCommand({
    Bucket: getBucket(),
    Key: key,
  });
  const response = await getClient().send(command);
  const bytes = await response.Body!.transformToByteArray();
  return Buffer.from(bytes);
}

export async function deleteObject(key: string): Promise<void> {
  const input: DeleteObjectCommandInput = {
    Bucket: getBucket(),
    Key: key,
  };
  await getClient().send(new DeleteObjectCommand(input));
}

// ============================================================
// Media Hub: 独立的 US S3 客户端（跟报销 MinIO 完全隔离）
// 视频文件必须放美区，因为发布到 YouTube/IG/TikTok 是跨境调用，
// 国内 MinIO → US API 走太慢，美区 S3 → US API 同区秒传。
// ============================================================

let mediaHubClient: S3Client | null = null;

function getMediaHubClient(): S3Client {
  if (!mediaHubClient) {
    const region = process.env.MEDIA_HUB_S3_REGION ?? "us-east-1";
    const accessKey = process.env.MEDIA_HUB_S3_ACCESS_KEY;
    const secretKey = process.env.MEDIA_HUB_S3_SECRET_KEY;
    /** 可选：用 R2/其他 S3 兼容服务时填；AWS S3 留空走默认 endpoint */
    const endpoint = process.env.MEDIA_HUB_S3_ENDPOINT;

    if (!accessKey || !secretKey) {
      throw new Error(
        "Missing MEDIA_HUB_S3_ACCESS_KEY or MEDIA_HUB_S3_SECRET_KEY",
      );
    }

    mediaHubClient = new S3Client({
      region,
      credentials: {
        accessKeyId: accessKey,
        secretAccessKey: secretKey,
      },
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
    });
  }
  return mediaHubClient;
}

function getMediaHubBucket(): string {
  const bucket = process.env.MEDIA_HUB_S3_BUCKET;
  if (!bucket) {
    throw new Error("Missing MEDIA_HUB_S3_BUCKET environment variable");
  }
  return bucket;
}

export async function getMediaHubPresignedUploadUrl(
  key: string,
  contentType: string,
  expiresIn = 3600,
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: getMediaHubBucket(),
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(getMediaHubClient(), command, { expiresIn });
}

export async function getMediaHubPresignedDownloadUrl(
  key: string,
  expiresIn = 3600,
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: getMediaHubBucket(),
    Key: key,
  });
  return getSignedUrl(getMediaHubClient(), command, { expiresIn });
}

/** 后台任务读取 Media Hub S3 中的小型输入文件（例如首帧图片）。 */
export async function getMediaHubObject(key: string): Promise<Buffer> {
  const response = await getMediaHubClient().send(
    new GetObjectCommand({
      Bucket: getMediaHubBucket(),
      Key: key,
    }),
  );
  if (!response.Body) {
    throw new Error(`Empty body for media-hub object: ${key}`);
  }
  const bytes = await response.Body.transformToByteArray();
  return Buffer.from(bytes);
}

/** worker 拉视频流给 YouTube SDK 用，避免整个视频读进内存 */
export async function getMediaHubObjectStream(
  key: string,
): Promise<NodeJS.ReadableStream> {
  const response = await getMediaHubClient().send(
    new GetObjectCommand({
      Bucket: getMediaHubBucket(),
      Key: key,
    }),
  );
  if (!response.Body) {
    throw new Error(`Empty body for media-hub object: ${key}`);
  }
  return response.Body as NodeJS.ReadableStream;
}

export interface MediaHubObjectResponse {
  body: ReadableStream<Uint8Array>;
  contentLength: number | null;
  contentRange: string | null;
  contentType: string | null;
  etag: string | null;
}

/** 为同源 HTTP 播放代理读取完整或 Range 视频流。 */
export async function getMediaHubObjectResponse(
  key: string,
  range?: string,
): Promise<MediaHubObjectResponse> {
  const response = await getMediaHubClient().send(
    new GetObjectCommand({
      Bucket: getMediaHubBucket(),
      Key: key,
      Range: range,
    }),
  );
  if (!response.Body) {
    throw new Error(`Empty body for media-hub object: ${key}`);
  }
  return {
    body: response.Body.transformToWebStream(),
    contentLength: response.ContentLength ?? null,
    contentRange: response.ContentRange ?? null,
    contentType: response.ContentType ?? null,
    etag: response.ETag ?? null,
  };
}

/** 直接把 Buffer 写入 MediaHub S3（bot intake 等场景） */
export async function putMediaHubObject(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  const command = new PutObjectCommand({
    Bucket: getMediaHubBucket(),
    Key: key,
    Body: body,
    ContentType: contentType,
    ContentLength: body.length,
  });
  await getMediaHubClient().send(command);
}

export async function deleteMediaHubObject(key: string): Promise<void> {
  const input: DeleteObjectCommandInput = {
    Bucket: getMediaHubBucket(),
    Key: key,
  };
  await getMediaHubClient().send(new DeleteObjectCommand(input));
}
