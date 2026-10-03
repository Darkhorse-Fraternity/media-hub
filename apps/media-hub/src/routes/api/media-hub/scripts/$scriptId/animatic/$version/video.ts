import { createFileRoute } from "@tanstack/react-router";

import { auth } from "~/auth/server";
import { serveOwnedAnimatic } from "~/lib/script-animatic-video";

export const Route = createFileRoute(
  "/api/media-hub/scripts/$scriptId/animatic/$version/video",
)({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session) return new Response("Unauthorized", { status: 401 });
        return serveOwnedAnimatic(
          request,
          session.user.id,
          params.scriptId,
          params.version,
        );
      },
    },
  },
});
