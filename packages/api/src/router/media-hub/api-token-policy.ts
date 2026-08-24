export interface MediaHubAgentTokenActorPolicy {
  role: string | null;
  banned: boolean | null;
}

export function canUseMediaHubAgentToken(
  actor: MediaHubAgentTokenActorPolicy | null | undefined,
): boolean {
  return Boolean(
    actor &&
    !actor.banned &&
    (actor.role === "member" || actor.role === "admin"),
  );
}
