interface ContinuityReadiness {
  mode: "native_av" | "independent";
  healthStatus?: string;
  healthError?: string;
  selectedProfile?: string;
  defaultProfile?: string;
  profiles: { id: string; supportsNativeAVContinuation?: boolean }[];
}

export function scriptNativeContinuityIssue(
  input: ContinuityReadiness,
): string | null {
  if (input.mode !== "native_av") return null;
  if (input.healthError) return `无法检查原生音视频衔接：${input.healthError}`;
  if (!input.healthStatus) return "正在检查原生音视频衔接能力…";
  if (input.healthStatus !== "healthy")
    return "生成服务暂不可用，无法进行原生音视频衔接。";
  const profileId =
    input.selectedProfile === ""
      ? input.defaultProfile
      : (input.selectedProfile ?? input.defaultProfile);
  const profile = input.profiles.find(
    (candidate) => candidate.id === profileId,
  );
  if (!profile?.supportsNativeAVContinuation) {
    return "当前工作流尚未启用原生音视频衔接。请选择支持该能力的工作流，或更新生成服务。";
  }
  return null;
}
