export function scriptAnimaticPrefix(userId: string, scriptId: string): string {
  return `media-hub/animatics/${userId}/${scriptId}/`;
}

export function scriptAnimaticKey(
  userId: string,
  scriptId: string,
  version: number,
): string {
  return `${scriptAnimaticPrefix(userId, scriptId)}preview-${version}.mp4`;
}
