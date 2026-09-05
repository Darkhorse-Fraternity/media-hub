export interface ScriptShotAssemblyJob {
  id: string;
  scriptShotId: string | null;
  status: string;
  kind: string;
  outputStorageKey: string | null;
}

export function selectLatestScriptShotJobs<TJob extends ScriptShotAssemblyJob>(
  shotIds: string[],
  jobs: TJob[],
): TJob[] | null {
  const latestByShot = new Map<string, TJob>();
  for (const job of jobs) {
    if (job.kind === "assemble" || !job.scriptShotId) continue;
    if (!latestByShot.has(job.scriptShotId)) {
      latestByShot.set(job.scriptShotId, job);
    }
  }
  const selected: TJob[] = [];
  for (const shotId of shotIds) {
    const job = latestByShot.get(shotId);
    if (!job || job.status !== "succeeded" || !job.outputStorageKey)
      return null;
    selected.push(job);
  }
  return selected;
}
