import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod/v4";

import {
  agentJson,
  createAgentApiCaller,
  handleAgentApiError,
} from "~/lib/agent-api";

async function handleGet(request: Request): Promise<Response> {
  try {
    const { caller } = await createAgentApiCaller(request);
    const url = new URL(request.url);
    const limit = z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(100)
      .parse(url.searchParams.get("limit") ?? undefined);
    const result = await caller.mediaHub.image.list({ limit });
    return agentJson({ assets: result.assets });
  } catch (error) {
    return handleAgentApiError(error);
  }
}

export const Route = createFileRoute("/api/v1/image-assets")({
  server: { handlers: { GET: ({ request }) => handleGet(request) } },
});
