import { createFileRoute } from "@tanstack/react-router";

import { handlePrevisGroups } from "~/lib/agent-previs";

export const Route = createFileRoute("/api/v1/previs-groups")({
  server: {
    handlers: {
      GET: ({ request }) => handlePrevisGroups(request),
      POST: ({ request }) => handlePrevisGroups(request),
    },
  },
});
