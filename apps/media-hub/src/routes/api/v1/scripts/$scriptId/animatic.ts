import { createFileRoute } from "@tanstack/react-router";

import {
  agentJson,
  createAgentApiCaller,
  handleAgentApiError,
} from "~/lib/agent-api";

export const Route = createFileRoute("/api/v1/scripts/$scriptId/animatic")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        try {
          const { caller } = await createAgentApiCaller(request);
          return agentJson(
            await caller.mediaHub.script.createAnimatic({
              id: params.scriptId,
            }),
            201,
          );
        } catch (error) {
          return handleAgentApiError(error);
        }
      },
    },
  },
});
