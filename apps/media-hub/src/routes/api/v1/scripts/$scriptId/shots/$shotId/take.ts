import { createFileRoute } from "@tanstack/react-router";

import {
  agentJson,
  createAgentApiCaller,
  handleAgentApiError,
  readAgentJson,
} from "~/lib/agent-api";
import { selectScriptTakeBody } from "~/lib/agent-video-script";

export const Route = createFileRoute(
  "/api/v1/scripts/$scriptId/shots/$shotId/take",
)({
  server: {
    handlers: {
      PATCH: async ({ request, params }) => {
        try {
          const { caller } = await createAgentApiCaller(request);
          const body = selectScriptTakeBody.parse(await readAgentJson(request));
          return agentJson(
            await caller.mediaHub.script.selectTake({
              id: params.scriptId,
              shotId: params.shotId,
              jobId: body.job_id,
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
