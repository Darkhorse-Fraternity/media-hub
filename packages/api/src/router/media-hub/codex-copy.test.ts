import http from "node:http";
import { describe, expect, it } from "vitest";

import {
  buildImagePromptOptimizationPrompt,
  buildPlatformDescriptionPrompt,
  buildVideoPromptOptimizationPrompt,
  normalizeCodexCopy,
  queryCodexWorker,
  readCodexWorkerResponse,
  removeGeneratedDurationLead,
} from "./codex-copy";

describe("Media Hub Codex copy prompts", () => {
  it("builds a still-image HiDream generation prompt", () => {
    const prompt = buildImagePromptOptimizationPrompt({
      prompt: "生成一张美女图片",
      title: "人物主视觉",
      width: 768,
      height: 1344,
      referenceImageCount: 0,
      language: "zh",
    });

    expect(prompt).toContain("HiDream image generation");
    expect(prompt).toContain("Target canvas: 768 × 1344 pixels");
    expect(prompt).toContain("still image");
    expect(prompt).toContain("No reference image is supplied");
    expect(prompt).toContain("生成一张美女图片");
    expect(prompt).toContain("Simplified Chinese");
  });

  it("builds a reference-aware HiDream edit prompt", () => {
    const prompt = buildImagePromptOptimizationPrompt({
      prompt: "把背景改成雨夜东京",
      negativePrompt: "文字，水印",
      width: 1024,
      height: 1024,
      referenceImageCount: 2,
      language: "en",
    });

    expect(prompt).toContain("HiDream image editing");
    expect(prompt).toContain("2 reference images are supplied");
    expect(prompt).toContain("preserving all unrequested");
    expect(prompt).toContain("文字，水印");
    expect(prompt).toContain("natural English");
  });

  it("builds a duration-aware H3 optimization prompt", () => {
    const prompt = buildVideoPromptOptimizationPrompt({
      prompt: "一只机器人在客厅陪小狗玩",
      title: "陪伴时刻",
      durationSeconds: 30,
      hasReferenceImage: true,
      language: "zh",
    });

    expect(prompt).toContain("MiniMax H3");
    expect(prompt).toContain("Target duration: 30 seconds");
    expect(prompt).toContain("=== SEGMENT 1/2 ===");
    expect(prompt).toContain("integrated_multimodal_description");
    expect(prompt).toContain("overall_soundscape");
    expect(prompt).toContain("non_diegetic_music");
    expect(prompt).toContain("A first-frame reference image is supplied");
    expect(prompt).toContain(
      "For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.",
    );
    expect(prompt).toContain("[Shot N] At 00:SS.mmm");
    expect(prompt).toContain("一只机器人在客厅陪小狗玩");
    expect(prompt).toContain("Return only the optimized prompt text");
    expect(prompt).toContain(
      "Requested dialogue and visible-text language: Simplified Chinese",
    );
    expect(prompt).toContain("production direction in precise natural English");
  });

  it("removes a generated duration label without changing action timing", () => {
    expect(
      removeGeneratedDurationLead("30秒，胖丁机器人在客厅陪猫咪玩。", 30),
    ).toBe("胖丁机器人在客厅陪猫咪玩。");
    expect(
      removeGeneratedDurationLead("约 30 秒：镜头从猫窝缓慢推近。", 30),
    ).toBe("镜头从猫窝缓慢推近。");
    expect(
      removeGeneratedDurationLead(
        "30 seconds — A slow dolly-in reveals the cat.",
        30,
      ),
    ).toBe("A slow dolly-in reveals the cat.");
    expect(
      removeGeneratedDurationLead("30秒后，机器人转头看向猫咪。", 30),
    ).toBe("30秒后，机器人转头看向猫咪。");
  });

  it("builds platform-specific generation and optimization instructions", () => {
    const instagram = buildPlatformDescriptionPrompt({
      videoJobId: "job-instagram",
      prompt: "Pumpkii follows a cat through the living room",
      title: "A quiet afternoon",
      durationSeconds: 30,
      platform: "instagram",
      language: "zh",
      accountLabel: "@pumpkii_robot",
    });
    const youtube = buildPlatformDescriptionPrompt({
      videoJobId: "job-youtube",
      prompt: "Pumpkii follows a cat through the living room",
      durationSeconds: 60,
      platform: "youtube",
      language: "en",
      currentDescription: "Watch our robot play with a cat.",
    });

    expect(instagram).toContain("Instagram Reels caption");
    expect(instagram).toContain("job-instagram");
    expect(instagram).toContain("Video duration: 30 seconds");
    expect(instagram).toContain("5–10 relevant hashtags");
    expect(instagram).toContain("Create a new description");
    expect(instagram).toContain("Simplified Chinese");
    expect(youtube).toContain("YouTube description");
    expect(youtube).toContain("natural English");
    expect(youtube).toContain("Current description to improve");
  });

  it("removes a markdown fence and enforces the output limit", () => {
    expect(normalizeCodexCopy("```text\nReady to post\n```", 100)).toBe(
      "Ready to post",
    );
    expect(normalizeCodexCopy("123456", 4)).toBe("1234");
  });

  it("reads the final result from the Codex Worker stream", async () => {
    const response = new Response(
      [
        JSON.stringify({ type: "progress", status: "正在启动 Codex..." }),
        JSON.stringify({ type: "result", result: "优化后的视频提示词" }),
        "",
      ].join("\n"),
      { headers: { "content-type": "application/x-ndjson" } },
    );

    await expect(readCodexWorkerResponse(response, 5000)).resolves.toBe(
      "优化后的视频提示词",
    );
  });

  it("surfaces an error returned by the Codex Worker stream", async () => {
    const response = new Response(
      `${JSON.stringify({ type: "error", error: "模型暂时不可用" })}\n`,
      { headers: { "content-type": "application/x-ndjson" } },
    );

    await expect(readCodexWorkerResponse(response, 5000)).rejects.toThrow(
      "模型暂时不可用",
    );
  });

  it("does not reuse stale Worker connections and retries a transient close", async () => {
    let attempts = 0;
    let connectionHeader = "";
    const server = http.createServer((request, response) => {
      attempts += 1;
      connectionHeader = request.headers.connection ?? "";
      if (attempts === 1) {
        request.socket.destroy();
        return;
      }
      response.writeHead(200, {
        "Content-Type": "application/x-ndjson",
      });
      response.end(
        `${JSON.stringify({ type: "result", result: "优化完成" })}\n`,
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();

    try {
      if (!address || typeof address === "string") {
        throw new Error("测试服务器未启动");
      }
      await expect(
        queryCodexWorker(
          `http://127.0.0.1:${address.port}/query`,
          "原始提示词",
          "knowledge-bot",
          60_000,
          5000,
        ),
      ).resolves.toBe("优化完成");
      expect(attempts).toBe(2);
      expect(connectionHeader).toBe("close");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
