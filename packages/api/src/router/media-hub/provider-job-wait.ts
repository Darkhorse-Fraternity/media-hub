export interface ProviderJobTiming {
  status: string;
  created_at?: string;
  started_at?: string;
}

const TERMINAL_STATUSES = new Set(["succeeded", "failed", "canceled"]);
const QUEUE_TIMEOUT_MS = 24 * 60 * 60_000;
const GENERATION_TIMEOUT_MS = 60 * 60_000;

export class ProviderJobWaitTimeoutError extends Error {
  readonly code: string;
  readonly failureStage: string;
  readonly retryable = true;

  constructor(queued: boolean) {
    super(
      queued
        ? "GPU 排队超时（超过 24 小时）"
        : "MiniMax H3 实际生成超时（超过 1 小时，不含 GPU 排队）",
    );
    this.name = "ProviderJobWaitTimeoutError";
    this.code = queued ? "gpu_queue_timeout" : "provider_generation_timeout";
    this.failureStage = queued ? "gpu_scheduling" : "provider_execution";
  }
}

export function providerTimestamp(value: string | undefined): number | null {
  if (!value) return null;
  // Provider timestamps without an offset are UTC, like the database timestamps.
  const timestamp = Date.parse(
    /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : `${value}Z`,
  );
  return Number.isFinite(timestamp) ? timestamp : null;
}

/** Queue and execution have independent budgets, including after reconnection. */
export async function waitForGenerationProviderJob<
  T extends ProviderJobTiming,
>(input: {
  fetchJob: () => Promise<T>;
  onPoll: (job: T) => Promise<void>;
  isRetryableError?: (error: unknown) => boolean;
  now?: () => number;
  sleep?: () => Promise<void>;
}): Promise<T> {
  const now = input.now ?? Date.now;
  const sleep =
    input.sleep ??
    (() => new Promise<void>((resolve) => setTimeout(resolve, 3_000)));
  const waitingSince = now();
  let runningSince: number | null = null;
  let disconnectedSince: number | null = null;
  while (true) {
    let job: T;
    try {
      job = await input.fetchJob();
      disconnectedSince = null;
    } catch (error) {
      if (!input.isRetryableError?.(error)) throw error;
      disconnectedSince ??= now();
      // Provider restarts and short outages must not orphan active GPU work.
      if (now() - disconnectedSince >= 5 * 60_000) throw error;
      await sleep();
      continue;
    }
    await input.onPoll(job);
    // A completed result remains usable even if polling was interrupted or delayed.
    if (TERMINAL_STATUSES.has(job.status)) return job;
    const polledAt = now();
    const queued = job.status === "queued";
    if (queued) {
      runningSince = null;
      const queuedAt = providerTimestamp(job.created_at) ?? waitingSince;
      if (polledAt - queuedAt >= QUEUE_TIMEOUT_MS) {
        throw new ProviderJobWaitTimeoutError(true);
      }
    } else {
      runningSince ??= providerTimestamp(job.started_at) ?? polledAt;
      if (polledAt - runningSince >= GENERATION_TIMEOUT_MS) {
        throw new ProviderJobWaitTimeoutError(false);
      }
    }
    await sleep();
  }
}
