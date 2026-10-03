import { createFileRoute } from "@tanstack/react-router";

import { authClient } from "~/auth/client";
import {
  LoginScreen,
  SessionLoadingScreen,
} from "~/components/media-hub-login";
import { VideoLibrary } from "~/components/video-library";

export const Route = createFileRoute("/videos")({
  component: VideosPage,
  head: () => ({ meta: [{ title: "作品库 · Pumpkii Media Hub" }] }),
});

function VideosPage() {
  const sessionQuery = authClient.useSession();
  if (sessionQuery.isPending) return <SessionLoadingScreen />;
  if (!sessionQuery.data?.user)
    return <LoginScreen onSuccess={() => void sessionQuery.refetch()} />;
  return (
    <VideoLibrary
      key={sessionQuery.data.user.id}
      currentUser={sessionQuery.data.user}
      isAdmin={sessionQuery.data.user.role === "admin"}
      onSignOut={() => void sessionQuery.refetch()}
    />
  );
}
