import { createTRPCRouter } from "../../trpc";
import { mediaAccountRouter } from "./account";
import { mediaAiRouter } from "./ai";
import { mediaApiTokenRouter } from "./api-token";
import { mediaGenerationRouter } from "./generation-router";
import { mediaInstagramRouter } from "./oauth-instagram";
import { mediaTaskRouter } from "./task";
import { mediaUploadRouter } from "./upload";
import { mediaYouTubeRouter } from "./youtube";

export const mediaHubRouter = createTRPCRouter({
  task: mediaTaskRouter,
  account: mediaAccountRouter,
  ai: mediaAiRouter,
  apiToken: mediaApiTokenRouter,
  upload: mediaUploadRouter,
  youtube: mediaYouTubeRouter,
  instagram: mediaInstagramRouter,
  generation: mediaGenerationRouter,
});
