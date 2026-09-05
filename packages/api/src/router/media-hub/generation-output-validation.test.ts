import { describe, expect, it } from "vitest";

import { generationMediaProbeIssues } from "./generation-output-validation";

const expected = { durationSeconds: 15, width: 960, height: 544, fps: 24 };

describe("H3 generated video output validation", () => {
  it("accepts the deployed H3 MP4 shape", () => {
    expect(
      generationMediaProbeIssues(
        {
          streams: [
            {
              codec_type: "video",
              codec_name: "h264",
              width: 960,
              height: 544,
              avg_frame_rate: "24/1",
            },
            {
              codec_type: "audio",
              codec_name: "aac",
              sample_rate: "32000",
              channels: 2,
            },
          ],
          format: { duration: "15.083333" },
        },
        expected,
      ),
    ).toEqual([]);
  });

  it("rejects a malformed or silent output before it becomes a draft", () => {
    expect(
      generationMediaProbeIssues(
        {
          streams: [
            {
              codec_type: "video",
              codec_name: "vp9",
              width: 1280,
              height: 704,
              avg_frame_rate: "30/1",
            },
          ],
          format: { duration: "9.5" },
        },
        expected,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("H.264"),
        expect.stringContaining("分辨率"),
        expect.stringContaining("帧率"),
        expect.stringContaining("时长"),
        expect.stringContaining("缺少音频轨"),
      ]),
    );
  });
});
