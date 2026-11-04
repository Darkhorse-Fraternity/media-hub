import { ProviderRequestError } from "./provider-request";

interface RetryJob {
  providerJobId: string | null;
  providerJobIds: string[];
  startedAt: Date | null;
  generationStartedAt?: Date | null;
  failureStage: string | null;
}

/** Confirm remote state before discarding an execution or its completed segments. */
export async function prepareGenerationRetry(
  job: RetryJob,
  fetchJob: (id: string) => Promise<{ status: string }>,
) {
  const ids = job.providerJobIds.length
    ? job.providerJobIds
    : job.providerJobId
      ? [job.providerJobId]
      : [];
  const statuses = await Promise.all(
    ids.map(async (id) => {
      try {
        return (await fetchJob(id)).status;
      } catch (error) {
        if (error instanceof ProviderRequestError && error.status === 404) {
          return "missing";
        }
        // An unreachable Provider does not prove its GPU work has stopped.
        throw error;
      }
    }),
  );
  if (
    statuses.some(
      (status) =>
        ![
          "queued",
          "running",
          "succeeded",
          "failed",
          "canceled",
          "missing",
        ].includes(status),
    )
  ) {
    throw new Error("原 Provider 任务尚不能安全重试，请稍后再试");
  }

  const rejectedOutput =
    job.failureStage === "output_validation" ||
    job.failureStage === "audio_dialogue_validation";
  const firstFailed = statuses.findIndex((status) =>
    ["failed", "canceled", "missing"].includes(status),
  );
  const restartFrom = rejectedOutput ? 0 : firstFailed;
  if (
    restartFrom >= 0 &&
    statuses
      .slice(restartFrom)
      .some((status) => ["queued", "running"].includes(status))
  ) {
    throw new Error("原 Provider 任务仍在运行，请等待结束后再重试");
  }
  const retainedIds = restartFrom < 0 ? ids : ids.slice(0, restartFrom);
  // A lost submit response has no saved ID: replay the original idempotent run.
  const resume = restartFrom < 0 && !rejectedOutput;
  return {
    providerJobId: retainedIds.at(-1) ?? null,
    providerJobIds: retainedIds,
    startedAt: resume ? job.startedAt : null,
    ...(job.generationStartedAt !== undefined
      ? {
          generationStartedAt: retainedIds.length
            ? job.generationStartedAt
            : null,
        }
      : {}),
  };
}
