import { createFileRoute } from "@tanstack/react-router";

import { eq } from "@acme/db";
import { db } from "@acme/db/client";
import { mediaGenerationJob } from "@acme/db/schema";
import { getMediaHubObjectResponse } from "@acme/storage";

import { auth } from "~/auth/server";
import { mediaVideoContentDisposition } from "~/lib/media-video";

const validRangePattern = /^bytes=(?:\d+-\d*|-\d+)$/;

async function handleGet(request: Request, jobId: string): Promise<Response> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const job = await db.query.mediaGenerationJob.findFirst({
    where: eq(mediaGenerationJob.id, jobId),
    columns: { createdBy: true, outputStorageKey: true, status: true },
  });
  const actorRole = (
    session.user as typeof session.user & { role?: string | null }
  ).role;
  const canAccessVideo =
    job && (actorRole === "admin" || job.createdBy === session.user.id);
  if (!canAccessVideo || job.status !== "succeeded" || !job.outputStorageKey) {
    return new Response("Video not found", { status: 404 });
  }

  const requestedRange = request.headers.get("range");
  if (requestedRange && !validRangePattern.test(requestedRange)) {
    return new Response("Invalid range", {
      status: 416,
      headers: { "Accept-Ranges": "bytes" },
    });
  }

  const object = await getMediaHubObjectResponse(
    job.outputStorageKey,
    requestedRange ?? undefined,
  );
  const download = new URL(request.url).searchParams.get("download") === "1";
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=300",
    "Content-Disposition": mediaVideoContentDisposition(jobId, download),
    "Content-Type": object.contentType ?? "video/mp4",
  });
  if (object.contentLength !== null) {
    headers.set("Content-Length", String(object.contentLength));
  }
  if (object.contentRange) headers.set("Content-Range", object.contentRange);
  if (object.etag) headers.set("ETag", object.etag);

  return new Response(object.body, {
    status: object.contentRange ? 206 : 200,
    headers,
  });
}

export const Route = createFileRoute("/api/media-hub/generation/$jobId/video")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleGet(request, params.jobId),
    },
  },
});
