import { createTRPCRouter } from "../../trpc";
import { mediaAccountRouter } from "./account";
import { mediaAiRouter } from "./ai";
import { mediaApiTokenRouter } from "./api-token";
import { mediaGenerationRouter } from "./generation-router";
import { mediaImageRouter } from "./image";
import { mediaDouyinRouter } from "./oauth-douyin";
import { mediaInstagramRouter } from "./oauth-instagram";
import { mediaSettingsRouter } from "./settings";
import { mediaTaskRouter } from "./task";
import { mediaUploadRouter } from "./upload";
import { mediaVideoScriptRouter } from "./video-script";
import { mediaYouTubeRouter } from "./youtube";

export const mediaHubRouter = createTRPCRouter({
  task: mediaTaskRouter,
  account: mediaAccountRouter,
  ai: mediaAiRouter,
  apiToken: mediaApiTokenRouter,
  upload: mediaUploadRouter,
  youtube: mediaYouTubeRouter,
  instagram: mediaInstagramRouter,
  douyin: mediaDouyinRouter,
  settings: mediaSettingsRouter,
  generation: mediaGenerationRouter,
  image: mediaImageRouter,
  script: mediaVideoScriptRouter,
});
