import { z } from "zod/v4";

import {
  createMediaPrevisGroupSchema,
  createMediaPrevisRevisionSchema,
  createMediaPrevisSceneSchema,
  deleteMediaPrevisGroupSchema,
  forkMediaPrevisSceneSchema,
  mediaPrevisIdempotencyKeySchema,
  updateMediaPrevisGroupSchema,
  updateMediaPrevisSceneSchema,
} from "@acme/validators";

import {
  agentJson,
  createAgentApiCaller,
  handleAgentApiError,
  readAgentJson,
} from "./agent-api";

export const createPrevisBody = createMediaPrevisSceneSchema
  .omit({
    idempotencyKey: true,
    groupId: true,
  })
  .extend({ group_id: createMediaPrevisSceneSchema.shape.groupId });
export const patchPrevisBody = z
  .object({
    version: updateMediaPrevisSceneSchema.shape.version,
    title: updateMediaPrevisSceneSchema.shape.title,
    description: updateMediaPrevisSceneSchema.shape.description,
    group_id: updateMediaPrevisSceneSchema.shape.groupId,
    thumbnail_artifact_id:
      updateMediaPrevisSceneSchema.shape.thumbnailArtifactId,
    archived: updateMediaPrevisSceneSchema.shape.archived,
    head_revision_id: updateMediaPrevisSceneSchema.shape.headRevisionId,
    expected_head_revision_id:
      updateMediaPrevisSceneSchema.shape.expectedHeadRevisionId,
  })
  .strict();
export const createPrevisRevisionBody = z
  .object({
    parent_revision_id: createMediaPrevisRevisionSchema.shape.parentRevisionId,
    recipe: createMediaPrevisRevisionSchema.shape.recipe,
    operations: createMediaPrevisRevisionSchema.shape.operations,
    views: createMediaPrevisRevisionSchema.shape.views,
    message: createMediaPrevisRevisionSchema.shape.message,
    set_current: createMediaPrevisRevisionSchema.shape.setCurrent,
    expected_head_revision_id:
      createMediaPrevisRevisionSchema.shape.expectedHeadRevisionId,
  })
  .strict();
export const forkPrevisBody = z
  .object({
    revision_id: forkMediaPrevisSceneSchema.shape.revisionId,
    title: forkMediaPrevisSceneSchema.shape.title,
  })
  .strict();

function idempotencyKey(request: Request) {
  return mediaPrevisIdempotencyKeySchema
    .optional()
    .parse(request.headers.get("Idempotency-Key") ?? undefined);
}

export async function handlePrevisGroups(request: Request): Promise<Response> {
  try {
    const { caller } = await createAgentApiCaller(request);
    if (request.method === "POST")
      return agentJson(
        await caller.mediaHub.previs.createGroup(
          createMediaPrevisGroupSchema.parse(await readAgentJson(request)),
        ),
        201,
      );
    return agentJson(await caller.mediaHub.previs.groups());
  } catch (error) {
    return handleAgentApiError(error);
  }
}

export async function handlePrevisGroup(
  request: Request,
  groupId: string,
): Promise<Response> {
  try {
    const { caller } = await createAgentApiCaller(request);
    if (request.method === "PATCH") {
      const body = updateMediaPrevisGroupSchema
        .omit({ id: true })
        .parse(await readAgentJson(request));
      return agentJson(
        await caller.mediaHub.previs.updateGroup({ ...body, id: groupId }),
      );
    }
    const body = deleteMediaPrevisGroupSchema
      .omit({ id: true })
      .parse(await readAgentJson(request));
    return agentJson(
      await caller.mediaHub.previs.deleteGroup({ ...body, id: groupId }),
    );
  } catch (error) {
    return handleAgentApiError(error);
  }
}

export async function handlePrevisThumbnail(
  request: Request,
  sceneId: string,
): Promise<Response> {
  try {
    const { caller } = await createAgentApiCaller(request);
    return agentJson(
      await caller.mediaHub.previs.thumbnail({ id: sceneId }),
      202,
    );
  } catch (error) {
    return handleAgentApiError(error);
  }
}

export async function handlePrevisList(request: Request): Promise<Response> {
  try {
    const { caller } = await createAgentApiCaller(request);
    const params = new URL(request.url).searchParams;
    return agentJson(
      await caller.mediaHub.previs.list({
        page: Number(params.get("page") ?? "1"),
        pageSize: Number(params.get("page_size") ?? "30"),
        search: params.get("search") ?? "",
        status: z
          .enum(["active", "archived", "all"])
          .parse(params.get("status") ?? "active"),
        groupId:
          params.get("group_id") === "ungrouped"
            ? null
            : z
                .string()
                .uuid()
                .optional()
                .parse(params.get("group_id") ?? undefined),
      }),
    );
  } catch (error) {
    return handleAgentApiError(error);
  }
}

export async function handlePrevisCreate(request: Request): Promise<Response> {
  try {
    const { caller } = await createAgentApiCaller(request);
    const { group_id, ...input } = createPrevisBody.parse(
      await readAgentJson(request),
    );
    return agentJson(
      await caller.mediaHub.previs.create({
        ...input,
        groupId: group_id,
        idempotencyKey: idempotencyKey(request),
      }),
      201,
    );
  } catch (error) {
    return handleAgentApiError(error);
  }
}

export async function handlePrevisGet(
  request: Request,
  sceneId: string,
): Promise<Response> {
  try {
    const { caller } = await createAgentApiCaller(request);
    return agentJson(await caller.mediaHub.previs.get({ id: sceneId }));
  } catch (error) {
    return handleAgentApiError(error);
  }
}

export async function handlePrevisPatch(
  request: Request,
  sceneId: string,
): Promise<Response> {
  try {
    const { caller } = await createAgentApiCaller(request);
    const input = patchPrevisBody.parse(await readAgentJson(request));
    return agentJson(
      await caller.mediaHub.previs.update({
        id: sceneId,
        version: input.version,
        title: input.title,
        description: input.description,
        groupId: input.group_id,
        thumbnailArtifactId: input.thumbnail_artifact_id,
        archived: input.archived,
        headRevisionId: input.head_revision_id,
        expectedHeadRevisionId: input.expected_head_revision_id,
      }),
    );
  } catch (error) {
    return handleAgentApiError(error);
  }
}

export async function handlePrevisRevisionList(
  request: Request,
  sceneId: string,
): Promise<Response> {
  try {
    const { caller } = await createAgentApiCaller(request);
    const params = new URL(request.url).searchParams;
    return agentJson(
      await caller.mediaHub.previs.revisions({
        id: sceneId,
        page: Number(params.get("page") ?? "1"),
        pageSize: Number(params.get("page_size") ?? "30"),
      }),
    );
  } catch (error) {
    return handleAgentApiError(error);
  }
}

export async function handlePrevisRevisionCreate(
  request: Request,
  sceneId: string,
): Promise<Response> {
  try {
    const { caller } = await createAgentApiCaller(request);
    const input = createPrevisRevisionBody.parse(await readAgentJson(request));
    return agentJson(
      await caller.mediaHub.previs.createRevision({
        id: sceneId,
        parentRevisionId: input.parent_revision_id,
        recipe: input.recipe,
        operations: input.operations,
        views: input.views,
        message: input.message,
        setCurrent: input.set_current,
        expectedHeadRevisionId: input.expected_head_revision_id,
        idempotencyKey: idempotencyKey(request),
      }),
      201,
    );
  } catch (error) {
    return handleAgentApiError(error);
  }
}

export async function handlePrevisRevisionGet(
  request: Request,
  revisionId: string,
): Promise<Response> {
  try {
    const { caller } = await createAgentApiCaller(request);
    return agentJson(await caller.mediaHub.previs.revision({ revisionId }));
  } catch (error) {
    return handleAgentApiError(error);
  }
}

export async function handlePrevisRevisionSource(
  request: Request,
  revisionId: string,
): Promise<Response> {
  try {
    const { caller } = await createAgentApiCaller(request);
    const { revision } = await caller.mediaHub.previs.revision({ revisionId });
    const response = agentJson({
      engineVersion: revision.engineVersion,
      schemaVersion: revision.schemaVersion,
      recipe: revision.recipe,
      views: revision.views,
      checksum: revision.checksum,
    });
    response.headers.set(
      "Content-Disposition",
      `attachment; filename="previs-${revision.sceneId}-v${revision.revisionNumber}.json"`,
    );
    return response;
  } catch (error) {
    return handleAgentApiError(error);
  }
}

export async function handlePrevisFork(
  request: Request,
  sceneId: string,
): Promise<Response> {
  try {
    const { caller } = await createAgentApiCaller(request);
    const input = forkPrevisBody.parse(await readAgentJson(request));
    return agentJson(
      await caller.mediaHub.previs.fork({
        id: sceneId,
        revisionId: input.revision_id,
        title: input.title,
        idempotencyKey: idempotencyKey(request),
      }),
      201,
    );
  } catch (error) {
    return handleAgentApiError(error);
  }
}
