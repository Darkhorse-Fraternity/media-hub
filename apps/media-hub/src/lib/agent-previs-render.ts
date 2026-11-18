import { z } from "zod/v4";

import { getMediaHubObjectResponse } from "@acme/storage";
import { mediaPrevisIdempotencyKeySchema } from "@acme/validators";

import {
  agentJson,
  createAgentApiCaller,
  handleAgentApiError,
  readAgentJson,
  readOptionalAgentJson,
} from "./agent-api";

export const createPrevisRenderBody = z
  .object({
    revision_id: z.string().uuid(),
    output_type: z.enum(["image", "video"]).optional(),
    profile: z.enum(["preview", "standard", "h3_reference"]).optional(),
    view_ids: z.array(z.string()).optional(),
    frames: z.array(z.number()).optional(),
    timeline_fps: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    fps: z.number().optional(),
    start_seconds: z.number().optional(),
    duration_seconds: z.number().optional(),
  })
  .strict();
const changeBody = z
  .object({ item_ids: z.array(z.string().uuid()).min(1).max(64).optional() })
  .strict();

export async function handlePrevisRenderCreate(
  request: Request,
  sceneId: string,
) {
  try {
    const { caller } = await createAgentApiCaller(request);
    const input = createPrevisRenderBody.parse(await readAgentJson(request));
    const result = await caller.mediaHub.previs.createRender({
      id: sceneId,
      revisionId: input.revision_id,
      outputType: input.output_type,
      profile: input.profile,
      viewIds: input.view_ids,
      frames: input.frames,
      timelineFps: input.timeline_fps,
      width: input.width,
      height: input.height,
      fps: input.fps,
      startSeconds: input.start_seconds,
      durationSeconds: input.duration_seconds,
      idempotencyKey: mediaPrevisIdempotencyKeySchema
        .optional()
        .parse(request.headers.get("Idempotency-Key") ?? undefined),
    });
    return agentJson(result, 202);
  } catch (error) {
    return handleAgentApiError(error);
  }
}
export async function handlePrevisRenderList(
  request: Request,
  sceneId: string,
) {
  try {
    const { caller } = await createAgentApiCaller(request);
    const params = new URL(request.url).searchParams;
    return agentJson(
      await caller.mediaHub.previs.renders({
        id: sceneId,
        page: Number(params.get("page") ?? 1),
        pageSize: Number(params.get("page_size") ?? 30),
      }),
    );
  } catch (error) {
    return handleAgentApiError(error);
  }
}
export async function handlePrevisRenderGet(
  request: Request,
  renderId: string,
) {
  try {
    const { caller } = await createAgentApiCaller(request);
    return agentJson(await caller.mediaHub.previs.render({ renderId }));
  } catch (error) {
    return handleAgentApiError(error);
  }
}
export async function handlePrevisRenderItems(
  request: Request,
  renderId: string,
) {
  try {
    const { caller } = await createAgentApiCaller(request);
    const params = new URL(request.url).searchParams;
    return agentJson(
      await caller.mediaHub.previs.renderItems({
        renderId,
        page: Number(params.get("page") ?? 1),
        pageSize: Number(params.get("page_size") ?? 64),
      }),
    );
  } catch (error) {
    return handleAgentApiError(error);
  }
}
export async function handlePrevisRenderChange(
  request: Request,
  renderId: string,
  action: "cancel" | "retry",
) {
  try {
    const { caller } = await createAgentApiCaller(request);
    const input = changeBody.parse(await readOptionalAgentJson(request));
    return agentJson(
      await caller.mediaHub.previs[
        action === "cancel" ? "cancelRender" : "retryRender"
      ]({ renderId, itemIds: input.item_ids }),
    );
  } catch (error) {
    return handleAgentApiError(error);
  }
}
export async function handlePrevisImagesImport(
  request: Request,
  renderId: string,
) {
  try {
    const { caller } = await createAgentApiCaller(request);
    const input = z
      .object({ artifact_ids: z.array(z.string().uuid()).min(1).max(64) })
      .strict()
      .parse(await readAgentJson(request));
    return agentJson(
      await caller.mediaHub.previs.importImages({
        renderId,
        artifactIds: input.artifact_ids,
      }),
    );
  } catch (error) {
    return handleAgentApiError(error);
  }
}
export async function previsArtifactResponse(
  request: Request,
  artifact: { id: string; contentType: string; storageKey: string },
  download: boolean,
) {
  const range = request.headers.get("range") ?? undefined;
  if (range && !/^bytes=(?:\d+-\d*|-\d+)$/.test(range))
    return new Response("Invalid range", { status: 416 });
  const object = await getMediaHubObjectResponse(artifact.storageKey, range);
  const headers = new Headers({
    "Content-Type": artifact.contentType,
    "Cache-Control": "private, max-age=300",
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${artifact.id}.${artifact.contentType === "image/png" ? "png" : "mp4"}"`,
  });
  if (object.contentLength !== null)
    headers.set("Content-Length", String(object.contentLength));
  if (object.contentRange) headers.set("Content-Range", object.contentRange);
  return new Response(object.body, {
    status: object.contentRange ? 206 : 200,
    headers,
  });
}
export async function handlePrevisArtifactDownload(
  request: Request,
  artifactId: string,
) {
  try {
    const { caller } = await createAgentApiCaller(request);
    const artifact = await caller.mediaHub.previs.artifact({ artifactId });
    return await previsArtifactResponse(
      request,
      artifact,
      new URL(request.url).searchParams.get("inline") !== "1",
    );
  } catch (error) {
    return handleAgentApiError(error);
  }
}
