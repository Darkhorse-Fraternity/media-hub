import { TRPCError } from "@trpc/server";

import { getMediaGenerationProviderHealth } from "./generation";

export async function requireH3Profile(
  profileId: string,
  kind: "generate" | "edit",
) {
  const health = await getMediaGenerationProviderHealth(false);
  if (health.status !== "healthy") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `H3 Provider 当前不可用：${health.message}`,
    });
  }
  const profile = health.profiles.find(
    (candidate) => candidate.id === profileId,
  );
  if (!profile) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `H3 Provider 未启用工作流 ${profileId}`,
    });
  }
  if (profile.kind !== kind) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `H3 工作流 ${profileId} 不支持${kind === "edit" ? "视频编辑" : "视频生成"}`,
    });
  }
  return profile;
}
