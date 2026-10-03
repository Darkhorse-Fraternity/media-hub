import { createFileRoute } from "@tanstack/react-router";

import { createAgentApiCaller, handleAgentApiError } from "~/lib/agent-api";
import { serveOwnedAnimatic } from "~/lib/script-animatic-video";

export const Route = createFileRoute(
  "/api/v1/scripts/$scriptId/animatic/$version/video",
)({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const { actor } = await createAgentApiCaller(request);
          return serveOwnedAnimatic(
            request,
            actor.id,
            params.scriptId,
            params.version,
          );
        } catch (error) {
          return handleAgentApiError(error);
        }
      },
    },
  },
});
