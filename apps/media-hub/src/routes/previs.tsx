import { createFileRoute } from "@tanstack/react-router";

import { PrevisWorkspace } from "~/components/previs-workspace";

export const Route = createFileRoute("/previs")({
  component: PrevisWorkspace,
  head: () => ({ meta: [{ title: "白模工作台 · Pumpkii Media Hub" }] }),
});
