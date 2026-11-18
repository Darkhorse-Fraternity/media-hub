import { describe, expect, it, vi } from "vitest";

import { waitForGenerationProviderJob } from "./provider-job-wait";

const iso = (minutes: number) => new Date(minutes * 60_000).toISOString();

describe("GPU queue and inference polling", () => {
  it("reconnects after a short outage and receives the existing GPU result", async () => {
    let elapsed = 0;
    const outage = new Error("Provider restarting");
    const fetchJob = vi
      .fn<() => Promise<{ status: string }>>()
      .mockRejectedValueOnce(outage)
      .mockRejectedValueOnce(outage)
      .mockResolvedValue({ status: "succeeded" });
    const result = await waitForGenerationProviderJob({
      fetchJob,
      onPoll: vi.fn(),
      isRetryableError: (error) => error === outage,
      now: () => elapsed,
      sleep: () => {
        elapsed += 60_000;
        return Promise.resolve();
      },
    });
    expect(result.status).toBe("succeeded");
    expect(fetchJob).toHaveBeenCalledTimes(3);
  });

  it("bounds reconnection attempts and preserves the transport error", async () => {
    let elapsed = 0;
    const outage = new Error("connection lost");
    await expect(
      waitForGenerationProviderJob({
        fetchJob: () => Promise.reject(outage),
        onPoll: vi.fn(),
        isRetryableError: () => true,
        now: () => elapsed,
        sleep: () => {
          elapsed += 60_000;
          return Promise.resolve();
        },
      }),
    ).rejects.toBe(outage);
    expect(elapsed).toBe(5 * 60_000);
  });

  it("does not retry permanent query failures", async () => {
    const sleep = vi.fn();
    const error = new Error("unauthorized");
    await expect(
      waitForGenerationProviderJob({
        fetchJob: () => Promise.reject(error),
        onPoll: vi.fn(),
        isRetryableError: () => false,
        sleep,
      }),
    ).rejects.toBe(error);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("allows over an hour of queueing followed by a full generation budget", async () => {
    let minutes = 0;
    const polls = [
      { status: "queued", created_at: iso(0) },
      { status: "queued", created_at: iso(0) },
      { status: "running", started_at: iso(120) },
      { status: "succeeded", started_at: iso(120) },
    ];
    const result = await waitForGenerationProviderJob({
      fetchJob: () => Promise.resolve(polls.shift() ?? { status: "failed" }),
      onPoll: vi.fn(),
      now: () => minutes * 60_000,
      sleep: () => {
        minutes += 60;
        return Promise.resolve();
      },
    });
    expect(result.status).toBe("succeeded");
    expect(minutes).toBe(180);
  });

  it("uses the Provider start time after reconnecting to an active generation", async () => {
    await expect(
      waitForGenerationProviderJob({
        fetchJob: () =>
          Promise.resolve({ status: "running", started_at: iso(10) }),
        onPoll: vi.fn(),
        now: () => 71 * 60_000,
      }),
    ).rejects.toMatchObject({
      code: "provider_generation_timeout",
      failureStage: "provider_execution",
    });
  });

  it("bounds a stuck queue separately and reports the scheduling failure", async () => {
    await expect(
      waitForGenerationProviderJob({
        fetchJob: () =>
          Promise.resolve({ status: "queued", created_at: iso(0) }),
        onPoll: vi.fn(),
        now: () => 24 * 60 * 60_000,
      }),
    ).rejects.toMatchObject({
      code: "gpu_queue_timeout",
      failureStage: "gpu_scheduling",
    });
  });

  it("keeps finished results when reconnecting after the execution deadline", async () => {
    const completed = { status: "succeeded", started_at: iso(0) };
    await expect(
      waitForGenerationProviderJob({
        fetchJob: () => Promise.resolve(completed),
        onPoll: vi.fn(),
        now: () => 90 * 60_000,
      }),
    ).resolves.toBe(completed);
  });

  it("stops immediately when the caller reports cancellation", async () => {
    const sleep = vi.fn();
    await expect(
      waitForGenerationProviderJob({
        fetchJob: () => Promise.resolve({ status: "running" }),
        onPoll: () => Promise.reject(new Error("canceled locally")),
        sleep,
      }),
    ).rejects.toThrow("canceled locally");
    expect(sleep).not.toHaveBeenCalled();
  });
});
