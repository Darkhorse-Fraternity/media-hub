import { describe, expect, it } from "vitest";

import {
  buildFeishuVideoContent,
  buildGenerationResultCard,
} from "./feishu-notify";

describe("buildGenerationResultCard", () => {
  it("builds a successful generation card with a direct video action", () => {
    const card = buildGenerationResultCard({
      jobId: "job-1",
      title: "Pumpkii launch",
      prompt: "A cinematic product launch video",
      status: "succeeded",
      durationSeconds: 30,
      language: "zh",
      elapsedSeconds: 95,
      fps: 24,
      width: 960,
      height: 544,
      referenceImageCount: 2,
      hasFirstFrame: true,
      providerJobId: "provider-job-1",
      videoBytes: 12_500_000,
      createdByLabel: "Service (service@punpkii.com)",
      videoUrl: "https://media.example.com/#generation-job-job-1",
    });

    expect(card.header.template).toBe("green");
    expect(card.header.title.content).toContain("视频生成完成");
    expect(JSON.stringify(card)).toContain("1 分 35 秒");
    expect(JSON.stringify(card)).toContain("打开 Media Hub 查看视频");
    expect(JSON.stringify(card)).toContain(
      "https://media.example.com/#generation-job-job-1",
    );
    expect(JSON.stringify(card)).toContain("960 × 544 · 24 FPS");
    expect(JSON.stringify(card)).toContain("内容语言");
    expect(JSON.stringify(card)).toContain("中文");
    expect(JSON.stringify(card)).toContain("首帧 1 张 · 其他 2 张");
    expect(JSON.stringify(card)).toContain("12.5 MB · MP4");
    expect(JSON.stringify(card)).toContain("MiniMax H3 · provider-job-1");
  });

  it("builds a failed generation card with the error message", () => {
    const card = buildGenerationResultCard({
      jobId: "job-2",
      title: null,
      prompt: "A failed sample",
      status: "failed",
      durationSeconds: 60,
      language: "en",
      elapsedSeconds: 12,
      fps: 24,
      width: 960,
      height: 544,
      referenceImageCount: 0,
      hasFirstFrame: false,
      createdByLabel: "Service",
      errorMessage: "provider timeout",
    });

    expect(card.header.template).toBe("red");
    expect(card.header.title.content).toContain("视频生成失败");
    expect(JSON.stringify(card)).toContain("provider timeout");
    expect(JSON.stringify(card)).not.toContain("打开 Media Hub 查看视频");
  });

  it("builds a native playable Feishu video message", () => {
    expect(buildFeishuVideoContent("file_v2_video", "img_v2_thumbnail")).toBe(
      '{"file_key":"file_v2_video","image_key":"img_v2_thumbnail"}',
    );
  });
});
