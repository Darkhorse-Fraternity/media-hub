import { createFileRoute } from "@tanstack/react-router";

import {
  handlePrevisRenderCreate,
  handlePrevisRenderList,
} from "~/lib/agent-previs-render";

export const Route = createFileRoute("/api/v1/previs/$sceneId/renders")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        handlePrevisRenderList(request, params.sceneId),
      POST: ({ request, params }) =>
        handlePrevisRenderCreate(request, params.sceneId),
    },
  },
});
