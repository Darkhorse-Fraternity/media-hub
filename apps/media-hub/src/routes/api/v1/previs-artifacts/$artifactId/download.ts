import { createFileRoute } from "@tanstack/react-router";

import { handlePrevisArtifactDownload } from "~/lib/agent-previs-render";

export const Route = createFileRoute(
  "/api/v1/previs-artifacts/$artifactId/download",
)({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        handlePrevisArtifactDownload(request, params.artifactId),
    },
  },
});
