import { createFileRoute } from "@tanstack/react-router";

import { handlePrevisRenderItems } from "~/lib/agent-previs-render";

export const Route = createFileRoute("/api/v1/previs-renders/$renderId/items")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        handlePrevisRenderItems(request, params.renderId),
    },
  },
});
