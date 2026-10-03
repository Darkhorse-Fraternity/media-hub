import { createFileRoute } from "@tanstack/react-router";

import { DirectorWorkspace } from "~/components/director-workspace";

export const Route = createFileRoute("/scripts_/$scriptId")({
  component: VideoScriptDetailPage,
  head: () => ({
    meta: [{ title: "脚本详情 · Pumpkii Media Hub" }],
  }),
});

function VideoScriptDetailPage() {
  const { scriptId } = Route.useParams();
  return <DirectorWorkspace initialScriptId={scriptId} />;
}
