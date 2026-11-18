import { createFileRoute } from "@tanstack/react-router";

import { handlePrevisRenderChange } from "~/lib/agent-previs-render";

export const Route = createFileRoute("/api/v1/previs-renders/$renderId/retry")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        handlePrevisRenderChange(request, params.renderId, "retry"),
    },
  },
});
