import { createFileRoute } from "@tanstack/react-router";

import { handlePrevisRenderGet } from "~/lib/agent-previs-render";

export const Route = createFileRoute("/api/v1/previs-renders/$renderId")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        handlePrevisRenderGet(request, params.renderId),
    },
  },
});
