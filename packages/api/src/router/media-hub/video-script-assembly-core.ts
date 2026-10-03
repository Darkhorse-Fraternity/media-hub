import { createHash } from "node:crypto";

import type { MediaVideoScriptShot } from "@acme/db/schema";

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
  selectedJobIds: Record<string, string> = {},
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
    const selectedId = selectedJobIds[shotId];
    const job = selectedId
      ? jobs.find(
          (candidate) =>
            candidate.id === selectedId &&
            candidate.scriptShotId === shotId &&
            candidate.kind !== "assemble",
        )
      : latestByShot.get(shotId);
    if (!job || job.status !== "succeeded" || !job.outputStorageKey)
      return null;
    selected.push(job);
  }
  return selected;
}

export function scriptAssemblyJobId(
  scriptId: string,
  sourceJobIds: string[],
  shots: MediaVideoScriptShot[],
  burnCaptions: boolean,
): string {
  const hasTrim = shots.some(
    (shot) =>
      (shot.trimStartSeconds ?? 0) !== 0 ||
      (shot.trimEndSeconds ?? shot.durationSeconds) !== shot.durationSeconds,
  );
  const editKey =
    hasTrim || burnCaptions
      ? JSON.stringify({
          trims: shots.map((shot) => [
            shot.id,
            shot.trimStartSeconds ?? 0,
            shot.trimEndSeconds ?? shot.durationSeconds,
          ]),
          captions: burnCaptions
            ? shots.map((shot) => shot.captions ?? [])
            : null,
          burnCaptions,
        })
      : "";
  const digest = createHash("sha256")
    .update(
      `${scriptId}:${sourceJobIds.join(":")}${editKey ? `:${editKey}` : ""}`,
    )
    .digest("hex")
    .slice(0, 32);
  return `assembly_${digest}`;
}
