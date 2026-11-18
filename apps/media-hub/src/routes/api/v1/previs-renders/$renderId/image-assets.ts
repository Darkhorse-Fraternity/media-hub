import { createFileRoute } from "@tanstack/react-router";

import { handlePrevisImagesImport } from "~/lib/agent-previs-render";

export const Route = createFileRoute(
  "/api/v1/previs-renders/$renderId/image-assets",
)({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        handlePrevisImagesImport(request, params.renderId),
    },
  },
});
