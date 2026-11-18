import { createFileRoute } from "@tanstack/react-router";

import { and, eq } from "@acme/db";
import { db } from "@acme/db/client";
import {
  mediaPrevisArtifact,
  mediaPrevisRender,
  mediaPrevisRenderItem,
} from "@acme/db/schema";

import { auth } from "~/auth/server";
import { previsArtifactResponse } from "~/lib/agent-previs-render";

export const Route = createFileRoute(
  "/api/media-hub/previs-artifacts/$artifactId",
)({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session) return new Response("Unauthorized", { status: 401 });
        const [row] = await db
          .select({ artifact: mediaPrevisArtifact })
          .from(mediaPrevisArtifact)
          .innerJoin(
            mediaPrevisRenderItem,
            eq(mediaPrevisArtifact.itemId, mediaPrevisRenderItem.id),
          )
          .innerJoin(
            mediaPrevisRender,
            eq(mediaPrevisRenderItem.renderId, mediaPrevisRender.id),
          )
          .where(
            and(
              eq(mediaPrevisArtifact.id, params.artifactId),
              eq(mediaPrevisRender.ownerUserId, session.user.id),
              eq(mediaPrevisRenderItem.status, "succeeded"),
            ),
          )
          .limit(1);
        if (!row) return new Response("Not found", { status: 404 });
        return previsArtifactResponse(
          request,
          row.artifact,
          new URL(request.url).searchParams.get("download") === "1",
        );
      },
    },
  },
});
