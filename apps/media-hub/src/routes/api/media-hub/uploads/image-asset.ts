import { createHash } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";

import { db } from "@acme/db/client";
import { mediaImageAsset } from "@acme/db/schema";
import { deleteMediaHubObject, putMediaHubObject } from "@acme/storage";

import { auth } from "~/auth/server";

const maxImageBytes = 5_000_000;
const imageExtensions = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

async function handlePost(request: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return jsonError("未登录或登录已过期", 401);

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return jsonError("无法读取上传内容", 400);
  }
  const file = formData.get("file");
  if (!(file instanceof File)) return jsonError("请选择图片", 400);
  if (file.size <= 0) return jsonError("图片为空", 400);
  if (file.size > maxImageBytes) return jsonError("图片超过 5 MB", 413);
  const extension = imageExtensions.get(file.type);
  if (!extension) return jsonError("仅支持 JPEG、PNG 或 WebP 图片", 415);

  const id = crypto.randomUUID();
  const key = `media-hub/image/${session.user.id}/${id}.${extension}`;
  const content = Buffer.from(await file.arrayBuffer());
  try {
    await putMediaHubObject(key, content, file.type);
    await db.insert(mediaImageAsset).values({
      id,
      storageKey: key,
      filename: file.name.slice(0, 255) || `${id}.${extension}`,
      contentType: file.type,
      sizeBytes: content.length,
      checksum: `sha256:${createHash("sha256").update(content).digest("hex")}`,
      origin: "upload",
      ownerUserId: session.user.id,
      createdAt: new Date(),
    });
    return Response.json({
      id,
      name: file.name,
      contentType: file.type,
      sizeBytes: content.length,
      url: `/api/media-hub/images/${encodeURIComponent(id)}`,
    });
  } catch (error) {
    await deleteMediaHubObject(key).catch(() => undefined);
    console.error("Media Hub image asset upload failed", {
      error: error instanceof Error ? error.message : String(error),
      userId: session.user.id,
    });
    return jsonError("图片保存失败，请稍后重试", 500);
  }
}

export const Route = createFileRoute("/api/media-hub/uploads/image-asset")({
  server: { handlers: { POST: ({ request }) => handlePost(request) } },
});
