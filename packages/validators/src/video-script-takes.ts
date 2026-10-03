export interface VideoScriptTake {
  id: string;
  scriptShotId: string | null;
  kind: string;
  status: string;
  outputStorageKey: string | null;
}

/** Jobs are ordered newest first. A lock never falls back to a different take. */
export function selectMediaVideoScriptTake<T extends VideoScriptTake>(
  shot: { id: string; selectedGenerationJobId?: string },
  jobs: T[],
): T | null {
  const take = jobs.find(
    (job) =>
      job.kind !== "assemble" &&
      job.scriptShotId === shot.id &&
      (!shot.selectedGenerationJobId ||
        job.id === shot.selectedGenerationJobId),
  );
  return take?.status === "succeeded" && take.outputStorageKey ? take : null;
}
