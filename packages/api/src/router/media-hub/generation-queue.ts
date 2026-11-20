import { z } from "zod/v4";

import type { mediaGenerationJob } from "@acme/db/schema";

import { h3SegmentCount } from "./h3-generation-config";

const providerActivePhase = z.enum([
  "provider_starting",
  "gpu_admission",
  "processing",
  "gpu_cleanup",
]);

export const providerQueueSnapshotSchema = z.object({
  active_phase: providerActivePhase.nullable(),
  jobs: z.record(
    z.string(),
    z.object({
      phase: z.union([z.literal("provider_queue"), providerActivePhase]),
      ahead_segments: z.number().int().nonnegative(),
    }),
  ),
});

export type ProviderQueueSnapshot = z.infer<typeof providerQueueSnapshotSchema>;

type VideoJob = Pick<
  typeof mediaGenerationJob.$inferSelect,
  | "kind"
  | "status"
  | "durationSeconds"
  | "editSegments"
  | "providerJobId"
  | "providerJobIds"
>;

export function videoJobUsesProviderQueue(job: VideoJob): boolean {
  return (
    job.kind !== "assemble" &&
    Boolean(job.providerJobId) &&
    ["waiting_for_gpu", "running"].includes(job.status)
  );
}

export function videoJobQueue(
  job: VideoJob,
  snapshot: ProviderQueueSnapshot | null,
) {
  const { status } = job;
  if (
    job.kind === "assemble" ||
    (status !== "queued" &&
      status !== "waiting_for_gpu" &&
      status !== "running")
  ) {
    return null;
  }

  const segmentCount =
    job.kind === "edit"
      ? job.editSegments.length
      : h3SegmentCount(job.durationSeconds);
  // Retries can retain IDs for later segments. The current ID, rather than
  // the length of that list, identifies the segment being polled.
  const currentIndex =
    job.providerJobId && segmentCount > 1
      ? job.providerJobIds.indexOf(job.providerJobId) + 1
      : 1;
  const segmentIndex =
    currentIndex > 0 && currentIndex <= segmentCount ? currentIndex : null;

  const provider =
    videoJobUsesProviderQueue(job) && job.providerJobId
      ? snapshot?.jobs[job.providerJobId]
      : undefined;
  const fallbackPhases = {
    queued: "scheduler",
    waiting_for_gpu: "provider_status_unavailable",
    running: job.providerJobId
      ? "provider_status_unavailable"
      : "provider_starting",
  } as const;
  const phase = provider?.phase ?? fallbackPhases[status];

  return {
    phase,
    aheadSegments: provider?.ahead_segments ?? null,
    blockingPhase:
      phase === "provider_queue" ? (snapshot?.active_phase ?? null) : null,
    segmentIndex,
    segmentCount: segmentCount || null,
  };
}
