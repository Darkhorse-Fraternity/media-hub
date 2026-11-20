import { describe, expect, it } from "vitest";

import {
  formatGenerationElapsed,
  formatVideoJobTiming,
} from "../lib/generation-display";

describe("formatGenerationElapsed", () => {
  it("returns null before generation starts", () => {
    expect(formatGenerationElapsed(null, null)).toBeNull();
  });

  it("formats a completed generation duration", () => {
    expect(
      formatGenerationElapsed(
        "2026-08-11T10:00:00.000Z",
        "2026-08-11T10:02:05.000Z",
      ),
    ).toBe("2 分 05 秒");
  });

  it("uses the current time while a generation is running", () => {
    expect(
      formatGenerationElapsed(
        "2026-08-11T10:00:00.000Z",
        null,
        new Date("2026-08-11T11:03:09.000Z").getTime(),
      ),
    ).toBe("1 小时 03 分 09 秒");
  });
});

describe("video queue and generation timing", () => {
  const queuedAt = "2026-10-19T02:40:00Z";
  const actualStart = "2026-10-19T03:15:00Z";
  const now = Date.parse("2026-10-19T03:26:00Z");

  it("shows 11 minutes of inference after 35 minutes of queueing", () => {
    expect(
      formatVideoJobTiming(
        {
          status: "running",
          startedAt: queuedAt,
          generationStartedAt: actualStart,
        },
        now,
      ),
    ).toBe("正在生成 · 11 分 00 秒");
  });

  it("shows a queue clock without suggesting that inference has started", () => {
    expect(
      formatVideoJobTiming(
        { status: "waiting_for_gpu", startedAt: queuedAt },
        now,
      ),
    ).toBe("等待 GPU · 已等待 46 分 00 秒");
  });

  it("shows the blocking phase, number of earlier segments and current segment", () => {
    expect(
      formatVideoJobTiming(
        {
          status: "waiting_for_gpu",
          startedAt: queuedAt,
          generationStartedAt: actualStart,
          queue: {
            phase: "provider_queue",
            blockingPhase: "gpu_cleanup",
            aheadSegments: 4,
            segmentIndex: 2,
            segmentCount: 3,
          },
        },
        now,
      ),
    ).toBe("等待前一段释放 GPU · 前面 4 段 · 第 2/3 段");
  });

  it("distinguishes a request for GPU access from a queue behind other jobs", () => {
    expect(
      formatVideoJobTiming({
        status: "waiting_for_gpu",
        queue: {
          phase: "gpu_admission",
          blockingPhase: null,
          aheadSegments: 0,
          segmentIndex: 1,
          segmentCount: 1,
        },
      }),
    ).toBe("等待分配 GPU · 前面 0 段 · 第 1/1 段");
  });

  it("reports completed inference and queue time separately", () => {
    expect(
      formatVideoJobTiming(
        {
          status: "succeeded",
          startedAt: queuedAt,
          generationStartedAt: actualStart,
          finishedAt: new Date(now),
        },
        now,
      ),
    ).toBe("生成耗时：11 分 00 秒 · 排队 35 分 00 秒");
  });

  it("labels historical records without Provider timestamps as total time", () => {
    expect(
      formatVideoJobTiming(
        {
          status: "succeeded",
          startedAt: queuedAt,
          finishedAt: new Date(now),
        },
        now,
      ),
    ).toBe("总耗时：46 分 00 秒");
  });
});
