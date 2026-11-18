import { createFileRoute } from "@tanstack/react-router";

import { handlePrevisThumbnail } from "~/lib/agent-previs";

export const Route = createFileRoute("/api/v1/previs/$sceneId/thumbnail")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        handlePrevisThumbnail(request, params.sceneId),
    },
  },
});
