import { describe, expect, it } from "vitest";

import {
  buildGenerationVideoPlayerHtml,
  generationNotificationRetryDelayMs,
} from "./generation-notification-core";

describe("generation notification retry policy", () => {
  it("backs off quickly and caps retries at five minutes", () => {
    expect(generationNotificationRetryDelayMs(1)).toBe(5_000);
    expect(generationNotificationRetryDelayMs(2)).toBe(10_000);
    expect(generationNotificationRetryDelayMs(3)).toBe(20_000);
    expect(generationNotificationRetryDelayMs(20)).toBe(300_000);
  });
});

describe("generation video notification player", () => {
  it("builds a mobile HTML5 player and escapes untrusted values", () => {
    const html = buildGenerationVideoPlayerHtml({
      title: 'A <video> & "title"',
      videoUrl: "https://s3.example.com/video.mp4?a=1&b=2",
    });

    expect(html).toContain("<video controls playsinline");
    expect(html).toContain("A &lt;video&gt; &amp; &quot;title&quot;");
    expect(html).toContain("https://s3.example.com/video.mp4?a=1&amp;b=2");
    expect(html).not.toContain('A <video> & "title"');
  });
});
