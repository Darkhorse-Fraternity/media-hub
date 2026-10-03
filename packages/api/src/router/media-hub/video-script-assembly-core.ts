import { createHash } from "node:crypto";

import type { MediaVideoScriptShot } from "@acme/db/schema";
import { selectMediaVideoScriptTake } from "@acme/validators";

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
  const selected: TJob[] = [];
  for (const shotId of shotIds) {
    const job = selectMediaVideoScriptTake(
      { id: shotId, selectedGenerationJobId: selectedJobIds[shotId] },
      jobs,
    );
    if (!job) return null;
    selected.push(job);
  }
  return selected;
}

export function scriptAssemblyJobId(
  scriptId: string,
  sourceJobIds: string[],
  shots: MediaVideoScriptShot[],
  burnCaptions: boolean,
  dimensions?: { width: number; height: number },
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
      `v3:${scriptId}:${sourceJobIds.join(":")}:${dimensions ? `${dimensions.width}x${dimensions.height}` : ""}${editKey ? `:${editKey}` : ""}`,
    )
    .digest("hex")
    .slice(0, 32);
  return `assembly_${digest}`;
}

export function selectScriptAssemblyJob<
  T extends { id: string; kind: string; updatedAt: Date },
>(jobs: T[], currentIds: (string | null)[]): T | null {
  return (
    jobs
      .filter((job) => job.kind === "assemble")
      .sort(
        (left, right) =>
          Number(currentIds.includes(right.id)) -
            Number(currentIds.includes(left.id)) ||
          right.updatedAt.getTime() - left.updatedAt.getTime(),
      )[0] ?? null
  );
}
