import { createFileRoute } from "@tanstack/react-router";

import { getMediaHubObjectResponse } from "@acme/storage";

import { createAgentApiCaller, handleAgentApiError } from "~/lib/agent-api";
import { mediaVideoContentDisposition } from "~/lib/media-video";

const validRangePattern = /^bytes=(?:\d+-\d*|-\d+)$/;

async function handleGet(request: Request, jobId: string): Promise<Response> {
  try {
    const { caller } = await createAgentApiCaller(request);
    const job = await caller.mediaHub.generation.getById({ id: jobId });
    if (job.status !== "succeeded" || !job.outputStorageKey) {
      return Response.json(
        { error: { code: "not_found", message: "Video not found" } },
        { status: 404 },
      );
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
    if (object.contentLength !== null)
      headers.set("Content-Length", String(object.contentLength));
    if (object.contentRange) headers.set("Content-Range", object.contentRange);
    if (object.etag) headers.set("ETag", object.etag);
    return new Response(object.body, {
      status: object.contentRange ? 206 : 200,
      headers,
    });
  } catch (error) {
    return handleAgentApiError(error);
  }
}

export const Route = createFileRoute("/api/v1/generations/$jobId/video")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleGet(request, params.jobId),
    },
  },
});
