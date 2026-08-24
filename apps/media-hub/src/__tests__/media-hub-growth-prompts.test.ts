import { describe, expect, it } from "vitest";

import {
  buildDailyReportSuggestionSystemPrompt,
  buildStructuredVideoScriptSystemPrompt,
  buildVideoMetadataPrompt,
  buildVideoScriptTextSystemPrompt,
} from "../../../../packages/api/src/router/media-hub/growth-prompts";

describe("Media Hub growth prompts", () => {
  it("positions metadata generation as pet companion robot growth marketing", () => {
    const prompt = buildVideoMetadataPrompt({
      fileName: "cat-video.mp4",
      userText: "发布到 Instagram",
    });

    expect(prompt).toContain("senior social media growth operator");
    expect(prompt).toContain("pet companion robot");
    expect(prompt).toContain("conversion");
    expect(prompt).toContain("Instagram");
    expect(prompt).toContain("YouTube");
    expect(prompt).toContain("Do not exaggerate");
  });

  it("requires daily report suggestions to include professional next actions", () => {
    const prompt = buildDailyReportSuggestionSystemPrompt();

    expect(prompt).toContain("资深宠物科技社媒增长顾问");
    expect(prompt).toContain("观察");
    expect(prompt).toContain("判断");
    expect(prompt).toContain("动作");
    expect(prompt).toContain("平台优先级");
  });

  it("applies the same growth strategy to video script generation", () => {
    const textPrompt = buildVideoScriptTextSystemPrompt(30);
    const structuredPrompt = buildStructuredVideoScriptSystemPrompt(30);

    for (const prompt of [textPrompt, structuredPrompt]) {
      expect(prompt).toContain("pet companion robot");
      expect(prompt).toContain("conversion");
      expect(prompt).toContain("Instagram");
      expect(prompt).toContain("YouTube");
      expect(prompt).toContain("Do not exaggerate");
    }
  });
});
