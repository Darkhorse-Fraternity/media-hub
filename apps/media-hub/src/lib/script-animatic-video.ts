import { and, eq, isNull } from "@acme/db";
import { db } from "@acme/db/client";
import { mediaVideoScript } from "@acme/db/schema";
import { getMediaHubObjectResponse } from "@acme/storage";

const validRangePattern = /^bytes=(?:\d+-\d*|-\d+)$/;

export async function serveOwnedAnimatic(
  request: Request,
  userId: string,
  scriptId: string,
  versionText: string,
): Promise<Response> {
  const version = Number(versionText);
  if (!Number.isSafeInteger(version) || version < 1) {
    return new Response("Invalid version", { status: 400 });
  }
  const script = await db.query.mediaVideoScript.findFirst({
    where: and(
      eq(mediaVideoScript.id, scriptId),
      eq(mediaVideoScript.createdBy, userId),
      isNull(mediaVideoScript.deletedAt),
    ),
    columns: { version: true },
  });
  if (script?.version !== version) {
    return new Response("Preview not found", { status: 404 });
  }
  const range = request.headers.get("range");
  if (range && !validRangePattern.test(range)) {
    return new Response("Invalid range", { status: 416 });
  }
  const key = `media-hub/animatics/${userId}/${scriptId}/preview.mp4`;
  try {
    const object = await getMediaHubObjectResponse(key, range ?? undefined);
    const headers = new Headers({
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, no-store",
      "Content-Type": object.contentType ?? "video/mp4",
      "Content-Disposition": "inline; filename=animatic.mp4",
    });
    if (object.contentLength !== null) {
      headers.set("Content-Length", String(object.contentLength));
    }
    if (object.contentRange) headers.set("Content-Range", object.contentRange);
    return new Response(object.body, {
      status: object.contentRange ? 206 : 200,
      headers,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      ["NoSuchKey", "NotFound"].includes(error.name)
    ) {
      return new Response("Preview not found", { status: 404 });
    }
    throw error;
  }
}
