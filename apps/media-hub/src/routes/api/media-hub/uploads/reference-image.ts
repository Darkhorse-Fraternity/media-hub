import { createFileRoute } from "@tanstack/react-router";

import { putMediaHubObject } from "@acme/storage";

import { auth } from "~/auth/server";

const maxReferenceImageBytes = 5_000_000;
const referenceImageExtensions = new Map([
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
  if (!(file instanceof File)) return jsonError("请选择参考图片", 400);
  if (file.size <= 0) return jsonError("参考图片为空", 400);
  if (file.size > maxReferenceImageBytes) {
    return jsonError("参考图片压缩后仍超过 5 MB", 413);
  }

  const extension = referenceImageExtensions.get(file.type);
  if (!extension) return jsonError("仅支持 JPEG、PNG 或 WebP 图片", 415);

  const key = `media-hub/cover/${session.user.id}/${crypto.randomUUID()}.${extension}`;
  try {
    await putMediaHubObject(
      key,
      Buffer.from(await file.arrayBuffer()),
      file.type,
    );
  } catch (error) {
    console.error("Media Hub reference image upload failed", {
      error: error instanceof Error ? error.message : String(error),
      key,
      userId: session.user.id,
    });
    return jsonError("对象存储写入失败，请稍后重试", 502);
  }

  return Response.json(
    { key, contentType: file.type, sizeBytes: file.size },
    { status: 201 },
  );
}

export const Route = createFileRoute("/api/media-hub/uploads/reference-image")({
  server: { handlers: { POST: ({ request }) => handlePost(request) } },
});
