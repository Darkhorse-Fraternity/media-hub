import { createFileRoute } from "@tanstack/react-router";

import { and, eq, isNull } from "@acme/db";
import { db } from "@acme/db/client";
import { mediaImageAsset } from "@acme/db/schema";
import { getMediaHubObjectResponse } from "@acme/storage";

import { auth } from "~/auth/server";

async function handleGet(request: Request, assetId: string): Promise<Response> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const asset = await db.query.mediaImageAsset.findFirst({
    where: and(
      eq(mediaImageAsset.id, assetId),
      eq(mediaImageAsset.ownerUserId, session.user.id),
      isNull(mediaImageAsset.deletedAt),
    ),
  });
  if (!asset) return new Response("Image not found", { status: 404 });

  const object = await getMediaHubObjectResponse(asset.storageKey);
  const download = new URL(request.url).searchParams.get("download") === "1";
  const extension =
    asset.contentType === "image/jpeg"
      ? "jpg"
      : asset.contentType === "image/webp"
        ? "webp"
        : "png";
  const encodedName = encodeURIComponent(asset.filename).replaceAll("'", "%27");
  const headers = new Headers({
    "Cache-Control": "private, max-age=300",
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${asset.id}.${extension}"; filename*=UTF-8''${encodedName}`,
    "Content-Type": object.contentType ?? asset.contentType,
  });
  if (object.contentLength !== null) {
    headers.set("Content-Length", String(object.contentLength));
  }
  if (object.etag) headers.set("ETag", object.etag);
  return new Response(object.body, { headers });
}

export const Route = createFileRoute("/api/media-hub/images/$assetId")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleGet(request, params.assetId),
    },
  },
});
