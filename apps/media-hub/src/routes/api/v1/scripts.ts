import { createFileRoute } from "@tanstack/react-router";

import {
  agentJson,
  createAgentApiCaller,
  handleAgentApiError,
  readAgentJson,
} from "~/lib/agent-api";
import {
  createScriptBody,
  mapContinuityBible,
  mapScriptShots,
} from "~/lib/agent-video-script";

async function handleGet(request: Request): Promise<Response> {
  try {
    const { caller } = await createAgentApiCaller(request);
    const url = new URL(request.url);
    return agentJson(
      await caller.mediaHub.script.list({
        page: Number(url.searchParams.get("page") ?? "1"),
        pageSize: Number(url.searchParams.get("page_size") ?? "30"),
      }),
    );
  } catch (error) {
    return handleAgentApiError(error);
  }
}

async function handlePost(request: Request): Promise<Response> {
  try {
    const { caller } = await createAgentApiCaller(request);
    const input = createScriptBody.parse(await readAgentJson(request));
    return agentJson(
      await caller.mediaHub.script.create({
        title: input.title,
        brief: input.brief,
        language: input.language,
        width: input.width,
        height: input.height,
        defaultProfile: input.default_profile,
        continuityBible: mapContinuityBible(input.continuity_bible),
        shots: mapScriptShots(input.shots),
      }),
      201,
    );
  } catch (error) {
    return handleAgentApiError(error);
  }
}

export const Route = createFileRoute("/api/v1/scripts")({
  server: {
    handlers: {
      GET: ({ request }) => handleGet(request),
      POST: ({ request }) => handlePost(request),
    },
  },
});
