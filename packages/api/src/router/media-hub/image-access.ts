/** Ordinary image-library access is owner-only, including for administrators. */
export function canAccessMediaImageAsset(input: {
  actorUserId: string;
  ownerUserId: string;
}): boolean {
  return input.actorUserId === input.ownerUserId;
}
