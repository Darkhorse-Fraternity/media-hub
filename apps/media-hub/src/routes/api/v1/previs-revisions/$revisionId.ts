import { createFileRoute } from "@tanstack/react-router";

import { handlePrevisRevisionGet } from "~/lib/agent-previs";

export const Route = createFileRoute("/api/v1/previs-revisions/$revisionId")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        handlePrevisRevisionGet(request, params.revisionId),
    },
  },
});
