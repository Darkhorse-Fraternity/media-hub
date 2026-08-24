export function canManageMediaPlatformAccount(input: {
  actorUserId: string;
  actorRole?: string | null;
  ownerUserId: string;
}): boolean {
  return input.actorRole === "admin" || input.actorUserId === input.ownerUserId;
}

export function isMediaHubAdmin(role?: string | null): boolean {
  return role === "admin";
}
