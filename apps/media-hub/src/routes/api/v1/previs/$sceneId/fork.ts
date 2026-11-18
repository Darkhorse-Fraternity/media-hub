import { createFileRoute } from "@tanstack/react-router";

import { handlePrevisFork } from "~/lib/agent-previs";

export const Route = createFileRoute("/api/v1/previs/$sceneId/fork")({
  server: {
    handlers: {
      POST: ({ request, params }) => handlePrevisFork(request, params.sceneId),
    },
  },
});
