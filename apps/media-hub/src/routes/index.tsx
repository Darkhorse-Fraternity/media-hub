import { createFileRoute } from "@tanstack/react-router";

import { DirectorWorkspace } from "~/components/director-workspace";

interface DirectorHomeSearch {
  imageAssets?: string;
}

export const Route = createFileRoute("/")({
  component: DirectorHome,
  validateSearch: (search: Record<string, unknown>): DirectorHomeSearch => ({
    imageAssets:
      typeof search.imageAssets === "string" ? search.imageAssets : undefined,
  }),
  head: () => ({ meta: [{ title: "导演台 · Pumpkii Media Hub" }] }),
});

function DirectorHome() {
  const { imageAssets } = Route.useSearch();
  const imageAssetIds = (imageAssets ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, 4);
  return <DirectorWorkspace imageAssetIds={imageAssetIds} />;
}
