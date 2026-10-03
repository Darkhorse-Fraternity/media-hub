import { createFileRoute } from "@tanstack/react-router";

import {
  agentJson,
  createAgentApiCaller,
  handleAgentApiError,
  readAgentJson,
} from "~/lib/agent-api";
import { scriptCaptionGenerateBody } from "~/lib/agent-video-script";

export const Route = createFileRoute(
  "/api/v1/scripts/$scriptId/shots/$shotId/captions/generate",
)({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        try {
          const { caller } = await createAgentApiCaller(request);
          const body = scriptCaptionGenerateBody.parse(
            await readAgentJson(request),
          );
          return agentJson(
            await caller.mediaHub.script.generateCaptions({
              id: params.scriptId,
              shotId: params.shotId,
              version: body.version,
            }),
          );
        } catch (error) {
          return handleAgentApiError(error);
        }
      },
    },
  },
});
