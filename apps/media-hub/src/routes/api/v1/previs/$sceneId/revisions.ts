import { createFileRoute } from "@tanstack/react-router";

import {
  handlePrevisRevisionCreate,
  handlePrevisRevisionList,
} from "~/lib/agent-previs";

export const Route = createFileRoute("/api/v1/previs/$sceneId/revisions")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        handlePrevisRevisionList(request, params.sceneId),
      POST: ({ request, params }) =>
        handlePrevisRevisionCreate(request, params.sceneId),
    },
  },
});
