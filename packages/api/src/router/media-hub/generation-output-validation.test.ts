import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import {
  generationMediaProbeIssues,
  validateGeneratedVideoOutput,
} from "./generation-output-validation";

const expected = { durationSeconds: 15, width: 960, height: 544, fps: 24 };
const fixtureShape = { durationSeconds: 5, width: 160, height: 96, fps: 24 };

async function videoFixture(filter: string): Promise<Buffer> {
  const { stdout } = await promisify(execFile)(
    process.env.FFMPEG_PATH ?? "ffmpeg",
    [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      filter,
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=5",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-movflags",
      "frag_keyframe+empty_moov",
      "-f",
      "mp4",
      "pipe:1",
    ],
    { encoding: "buffer", maxBuffer: 2_000_000 },
  );
  return stdout;
}

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

  it("rejects a playable MP4 with an audio track and only gray texture", async () => {
    const grayTexture = await videoFixture(
      "color=c=0x484748:s=160x96:r=24:d=5,noise=alls=8:allf=t",
    );
    const validation = validateGeneratedVideoOutput(grayTexture, fixtureShape);
    await expect(validation).rejects.toMatchObject({
      code: "output_validation_failed",
      failureStage: "output_validation",
    });
    await expect(validation).rejects.toThrow("低对比度灰纹");
  });

  it("accepts a mostly dark monochrome shot with a visible subject", async () => {
    const visibleSubject = await videoFixture(
      "color=c=black:s=160x96:r=24:d=5,drawbox=x=70:y=30:w=22:h=24:color=gray:t=fill:enable='between(t,1.5,3.5)'",
    );
    await expect(
      validateGeneratedVideoOutput(visibleSubject, fixtureShape),
    ).resolves.toBeUndefined();
  });
});
