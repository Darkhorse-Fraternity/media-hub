import { describe, expect, it, vi } from "vitest";

import { prepareGenerationRetry } from "./generation-retry";
import { ProviderRequestError } from "./provider-request";

const job = {
  providerJobId: "old-job",
  providerJobIds: ["old-job"],
  startedAt: new Date("2026-11-04T07:16:00Z"),
  generationStartedAt: new Date("2026-11-04T08:56:00Z"),
  failureStage: "provider_transport",
};

describe("retrying a disconnected generation", () => {
  it("does not require the separate generation timing schema change", async () => {
    const result = await prepareGenerationRetry(
      {
        providerJobId: job.providerJobId,
        providerJobIds: job.providerJobIds,
        startedAt: job.startedAt,
        failureStage: job.failureStage,
      },
      () => Promise.resolve({ status: "succeeded" }),
    );
    expect(result.startedAt).toEqual(job.startedAt);
    expect(result).not.toHaveProperty("generationStartedAt");
  });

  it.each(["queued", "running", "succeeded"])(
    "reattaches to a %s Provider job and preserves its run identity",
    async (status) => {
      await expect(
        prepareGenerationRetry(job, () => Promise.resolve({ status })),
      ).resolves.toEqual({
        providerJobId: job.providerJobId,
        providerJobIds: job.providerJobIds,
        startedAt: job.startedAt,
        generationStartedAt: job.generationStartedAt,
      });
    },
  );

  it("keeps completed segments and creates a new run for a confirmed failed segment", async () => {
    const fetchJob = vi.fn(async (id: string) => ({
      status: id === "first" ? "succeeded" : "failed",
    }));
    await expect(
      prepareGenerationRetry(
        {
          ...job,
          providerJobId: "second",
          providerJobIds: ["first", "second"],
        },
        fetchJob,
      ),
    ).resolves.toEqual({
      providerJobId: "first",
      providerJobIds: ["first"],
      startedAt: null,
      generationStartedAt: job.generationStartedAt,
    });
  });

  it("fails closed when the original task cannot be queried", async () => {
    const error = new ProviderRequestError("connection lost", {
      retryable: true,
    });
    await expect(
      prepareGenerationRetry(job, () => Promise.reject(error)),
    ).rejects.toBe(error);
  });

  it("replays the original idempotent run when a submit response was lost", async () => {
    const fetchJob = vi.fn();
    const result = await prepareGenerationRetry(
      { ...job, providerJobId: null, providerJobIds: [] },
      fetchJob,
    );
    expect(result.startedAt).toEqual(job.startedAt);
    expect(result.providerJobIds).toEqual([]);
    expect(fetchJob).not.toHaveBeenCalled();
  });

  it("preserves a possibly submitted run after an orchestration or database failure", async () => {
    const result = await prepareGenerationRetry(
      {
        ...job,
        providerJobId: null,
        providerJobIds: [],
        failureStage: "media_hub_orchestration",
      },
      vi.fn(),
    );
    expect(result.startedAt).toEqual(job.startedAt);
  });

  it.each(["failed", "canceled", "missing"])(
    "starts a new run when the original Provider job is %s",
    async (status) => {
      const fetchJob = () =>
        status === "missing"
          ? Promise.reject(
              new ProviderRequestError("not found", {
                status: 404,
                retryable: false,
              }),
            )
          : Promise.resolve({ status });
      await expect(prepareGenerationRetry(job, fetchJob)).resolves.toEqual({
        providerJobId: null,
        providerJobIds: [],
        startedAt: null,
        generationStartedAt: null,
      });
    },
  );

  it.each(["canceling", "unknown"])(
    "does not discard a %s task",
    async (status) => {
      await expect(
        prepareGenerationRetry(job, () => Promise.resolve({ status })),
      ).rejects.toThrow("尚不能安全重试");
    },
  );

  it("rerenders rejected output only after all old tasks have stopped", async () => {
    const rejected = { ...job, failureStage: "output_validation" };
    const result = await prepareGenerationRetry(rejected, () =>
      Promise.resolve({ status: "succeeded" }),
    );
    expect(result.providerJobIds).toEqual([]);
    expect(result.startedAt).toBeNull();
    await expect(
      prepareGenerationRetry(rejected, () =>
        Promise.resolve({ status: "running" }),
      ),
    ).rejects.toThrow("仍在运行");
  });
});
