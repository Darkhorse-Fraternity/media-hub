export function h3ReferenceAudioCapabilityIssue(
  profileId: string,
  requestedCount: number,
  maxReferenceAudios: number,
): string | null {
  if (requestedCount <= maxReferenceAudios) return null;
  if (maxReferenceAudios === 0) {
    return `当前 H3 工作流 ${profileId} 不支持独立参考音频或 <Audio N> 绑定；请使用支持音频条件的 generation profile`;
  }
  return `当前 H3 工作流最多支持 ${maxReferenceAudios} 个参考音频`;
}
