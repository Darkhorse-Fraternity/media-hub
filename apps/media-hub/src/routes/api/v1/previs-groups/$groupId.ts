import { createFileRoute } from "@tanstack/react-router";

import { handlePrevisGroup } from "~/lib/agent-previs";

export const Route = createFileRoute("/api/v1/previs-groups/$groupId")({
  server: {
    handlers: {
      PATCH: ({ request, params }) =>
        handlePrevisGroup(request, params.groupId),
      DELETE: ({ request, params }) =>
        handlePrevisGroup(request, params.groupId),
    },
  },
});
