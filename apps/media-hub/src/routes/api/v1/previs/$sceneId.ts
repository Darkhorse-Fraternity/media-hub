import { createFileRoute } from "@tanstack/react-router";

import { handlePrevisGet, handlePrevisPatch } from "~/lib/agent-previs";

export const Route = createFileRoute("/api/v1/previs/$sceneId")({
  server: {
    handlers: {
      GET: ({ request, params }) => handlePrevisGet(request, params.sceneId),
      PATCH: ({ request, params }) =>
        handlePrevisPatch(request, params.sceneId),
    },
  },
});
