import { createFileRoute } from "@tanstack/react-router";

import { handlePrevisCreate, handlePrevisList } from "~/lib/agent-previs";

export const Route = createFileRoute("/api/v1/previs")({
  server: {
    handlers: {
      GET: ({ request }) => handlePrevisList(request),
      POST: ({ request }) => handlePrevisCreate(request),
    },
  },
});
