export { type MediaHubAppRouter, mediaHubAppRouter } from "./root";
export { createTRPCContext } from "./trpc";

// Media Hub server-side helpers（脚本等场景跳过 tRPC 直调）
export {
  buildInstagramOAuthUrl,
  completeInstagramOAuthCallback,
} from "./router/media-hub/oauth-instagram";
export { fetchAndSaveStats } from "./router/media-hub/stats-fetcher";
export { sendDailyReport } from "./router/media-hub/daily-report";
export { authenticateMediaHubAgentToken } from "./router/media-hub/api-token";
export {
  cancelMediaGenerationJob,
  scheduleMediaGenerationJob,
} from "./router/media-hub/generation";
