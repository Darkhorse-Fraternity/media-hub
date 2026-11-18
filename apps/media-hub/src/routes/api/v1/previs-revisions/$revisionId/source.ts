import { createFileRoute } from "@tanstack/react-router";

import { handlePrevisRevisionSource } from "~/lib/agent-previs";

export const Route = createFileRoute(
  "/api/v1/previs-revisions/$revisionId/source",
)({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        handlePrevisRevisionSource(request, params.revisionId),
    },
  },
});
