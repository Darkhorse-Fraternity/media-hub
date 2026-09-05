import { createFileRoute } from "@tanstack/react-router";

import {
  agentJson,
  createAgentApiCaller,
  handleAgentApiError,
  readAgentJson,
} from "~/lib/agent-api";
import {
  mapContinuityBible,
  mapScriptShots,
  patchScriptBody,
} from "~/lib/agent-video-script";

async function handleGet(
  request: Request,
  scriptId: string,
): Promise<Response> {
  try {
    const { caller } = await createAgentApiCaller(request);
    return agentJson(await caller.mediaHub.script.get({ id: scriptId }));
  } catch (error) {
    return handleAgentApiError(error);
  }
}

async function handlePatch(
  request: Request,
  scriptId: string,
): Promise<Response> {
  try {
    const { caller } = await createAgentApiCaller(request);
    const patch = patchScriptBody.parse(await readAgentJson(request));
    const current = await caller.mediaHub.script.get({ id: scriptId });
    return agentJson(
      await caller.mediaHub.script.update({
        id: scriptId,
        version: patch.version,
        title: patch.title ?? current.title,
        brief: patch.brief ?? current.brief,
        copy: patch.copy ?? current.copy,
        copyStatus:
          patch.copy_status ??
          (current.copyStatus === "approved" ? "approved" : "draft"),
        language: patch.language ?? (current.language === "en" ? "en" : "zh"),
        width: patch.width ?? current.width,
        height: patch.height ?? current.height,
        defaultProfile:
          patch.default_profile === undefined
            ? (current.defaultProfile ?? undefined)
            : (patch.default_profile ?? undefined),
        continuityBible: patch.continuity_bible
          ? mapContinuityBible(patch.continuity_bible)
          : current.continuityBible,
        shots: patch.shots ? mapScriptShots(patch.shots) : current.shots,
      }),
    );
  } catch (error) {
    return handleAgentApiError(error);
  }
}

async function handleDelete(
  request: Request,
  scriptId: string,
): Promise<Response> {
  try {
    const { caller } = await createAgentApiCaller(request);
    return agentJson(await caller.mediaHub.script.delete({ id: scriptId }));
  } catch (error) {
    return handleAgentApiError(error);
  }
}

export const Route = createFileRoute("/api/v1/scripts/$scriptId")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleGet(request, params.scriptId),
      PATCH: ({ request, params }) => handlePatch(request, params.scriptId),
      DELETE: ({ request, params }) => handleDelete(request, params.scriptId),
    },
  },
});
