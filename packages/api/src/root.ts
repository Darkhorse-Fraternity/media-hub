import { adminRouter } from "./router/admin";
import { mediaHubRouter } from "./router/media-hub";
import { createTRPCRouter } from "./trpc";

export const mediaHubAppRouter = createTRPCRouter({
  admin: adminRouter,
  mediaHub: mediaHubRouter,
});

export type MediaHubAppRouter = typeof mediaHubAppRouter;
