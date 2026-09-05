export const editableMediaGenerationStatuses = ["scheduled", "queued"] as const;

export const activeMediaGenerationStatuses = [
  "scheduled",
  "queued",
  "waiting_for_gpu",
  "running",
] as const;

export const cancelableMediaGenerationStatuses = activeMediaGenerationStatuses;

export const deletableMediaGenerationStatuses = [
  "succeeded",
  "failed",
  "canceled",
] as const;

export const retryableMediaGenerationStatuses = ["failed"] as const;

export const protectedMediaPublishStatuses = ["publishing"] as const;

export const protectedMediaTaskStatuses = ["approved", "publishing"] as const;

export function canManageMediaGenerationJob(input: {
  actorUserId: string;
  actorRole?: string | null;
  ownerUserId: string;
}): boolean {
  return input.actorRole === "admin" || input.actorUserId === input.ownerUserId;
}

export function isEditableMediaGenerationStatus(status: string): boolean {
  return editableMediaGenerationStatuses.some((value) => value === status);
}

export function isCancelableMediaGenerationStatus(status: string): boolean {
  return cancelableMediaGenerationStatuses.some((value) => value === status);
}

export function isActiveMediaGenerationStatus(status: string): boolean {
  return activeMediaGenerationStatuses.some((value) => value === status);
}

export function isDeletableMediaGenerationStatus(status: string): boolean {
  return deletableMediaGenerationStatuses.some((value) => value === status);
}

export function isRetryableMediaGenerationStatus(status: string): boolean {
  return retryableMediaGenerationStatuses.some((value) => value === status);
}

export function isProtectedMediaPublishStatus(status: string): boolean {
  return protectedMediaPublishStatuses.some((value) => value === status);
}

export function isProtectedMediaTaskStatus(status: string): boolean {
  return protectedMediaTaskStatuses.some((value) => value === status);
}
