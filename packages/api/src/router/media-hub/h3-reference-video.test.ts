import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";

import { createMediaGenerationSchema } from "@acme/validators";

import {
  compileH3StructuredDialoguePrompt,
  validateH3ReferencePrompt,
} from "./h3-generation-config";
import {
  assertReferenceStorageOwner,
  h3ReferenceFrameCount,
  inspectH3ReferenceVideo,
  loadVerifiedH3ReferenceVideo,
  referenceVideoProbeMetadata,
} from "./h3-reference-video";

const get = vi.hoisted(() => vi.fn());
vi.mock("@acme/storage", () => ({ getMediaHubObject: get }));
const prompt = [
  "subject_definitions: <Subject 1> is a finished character from <Picture 1> mapped to the red proxy in <Video 1>.",
  "summary: [reference generation] Follow <Video 1> blocking and camera motion.",
  "retention_analysis: Retain trajectories and occlusion. Replace proxy geometry and colors.",
  "detailed_description: [Shot 1] The character crosses left to right in front of the box.",
  "overall_soundscape: No dialogue. Footsteps and outdoor ambience.",
  "non_diegetic_music: N/A",
].join("\n");

describe("whole-video reference generation", () => {
  it("requires an explicit reference mode and rejects first-frame and long-video mixing", () => {
    const body = {
      prompt,
      generationMode: "reference",
      durationSeconds: 5,
      referenceVideo: {
        storageKey: "media-hub/video/owner/abc.mp4",
        name: "previs.mp4",
        contentType: "video/mp4",
      },
    };
    expect(createMediaGenerationSchema.safeParse(body).success).toBe(true);
    for (const patch of [
      { referenceVideo: undefined },
      { generationMode: "base" },
      { durationSeconds: 30 },
      { sourceImageStorageKey: "first.png" },
    ]) {
      expect(
        createMediaGenerationSchema.safeParse({ ...body, ...patch }).success,
      ).toBe(false);
    }
  });

  it("keeps six-field prompts and structured native dialogue in reference mode", () => {
    expect(validateH3ReferencePrompt(prompt, 1)).toEqual([]);
    const compiled = compileH3StructuredDialoguePrompt(prompt, 5, [
      {
        segment: 1,
        speakerId: "S4",
        language: "zh",
        text: "你好。",
        delivery: "on_screen",
      },
    ]);
    expect(compiled.prompt).not.toContain("integrated_multimodal_description:");
    expect(
      compiled.prompt.indexOf("<d>[Mandarin Chinese] 你好。</d>"),
    ).toBeLessThan(compiled.prompt.indexOf("overall_soundscape:"));
    expect(validateH3ReferencePrompt(compiled.prompt, 1)).toEqual([]);
    expect(compiled.prompt).not.toContain("No dialogue");
    expect(
      validateH3ReferencePrompt(
        prompt.replace("non_diegetic_music: N/A", "non_diegetic_music:"),
        1,
      ).length,
    ).toBeGreaterThan(0);
    expect(validateH3ReferencePrompt(prompt, 0).join(" ")).toContain("未提供");
    expect(
      validateH3ReferencePrompt(
        prompt.replace("[reference generation]", "[video editing]"),
        1,
      ).length,
    ).toBeGreaterThan(0);
  });

  it("checks frame grid, aspect and actual frame rate", () => {
    expect([5, 10, 15].map(h3ReferenceFrameCount)).toEqual([124, 243, 362]);
    const probe = {
      streams: [
        {
          codec_type: "video",
          codec_name: "h264",
          width: 1344,
          height: 768,
          avg_frame_rate: "24/1",
          nb_read_frames: "124",
          duration: String(124 / 24),
        },
      ],
    };
    const expected = { width: 1344, height: 768, durationSeconds: 5 };
    expect(referenceVideoProbeMetadata(probe, expected).frameCount).toBe(124);
    for (const patch of [
      { avg_frame_rate: "30/1" },
      { nb_read_frames: "120" },
      { codec_name: "hevc" },
      { height: 1344 },
      { duration: "NaN" },
    ]) {
      expect(() =>
        referenceVideoProbeMetadata(
          { streams: [{ ...probe.streams[0], ...patch }] },
          expected,
        ),
      ).toThrow();
    }
  });

  it("blocks other users and path traversal before reading objects", () => {
    expect(() =>
      assertReferenceStorageOwner(
        "media-hub/video/owner/abc.mp4",
        "owner",
        "video",
      ),
    ).not.toThrow();
    for (const key of [
      "media-hub/video/other/abc.mp4",
      "media-hub/video/owner/../other/abc.mp4",
      "https://example.com/video.mp4",
    ]) {
      expect(() =>
        assertReferenceStorageOwner(key, "owner", "video"),
      ).toThrow();
    }
  });

  it("probes a real silent previs MP4 and saves its immutable checksum", async () => {
    const dir = await mkdtemp(join(tmpdir(), "h3-reference-test-"));
    try {
      const path = join(dir, "previs.mp4");
      await promisify(execFile)(process.env.FFMPEG_PATH ?? "ffmpeg", [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=gray:s=96x64:r=24",
        "-frames:v",
        "124",
        "-an",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        path,
      ]);
      get.mockResolvedValue(await readFile(path));
      const result = await inspectH3ReferenceVideo(
        {
          storageKey: "media-hub/video/owner/abc.mp4",
          name: "previs.mp4",
          contentType: "video/mp4",
        },
        "owner",
        { durationSeconds: 5, width: 96, height: 64 },
      );
      expect(result).toMatchObject({
        frameCount: 124,
        fps: 24,
        width: 96,
        height: 64,
      });
      expect(result.checksum).toMatch(/^sha256:[a-f0-9]{64}$/);
      await expect(loadVerifiedH3ReferenceVideo(result)).resolves.toEqual(
        await readFile(path),
      );
      get.mockResolvedValue(Buffer.from("changed-after-submission"));
      await expect(loadVerifiedH3ReferenceVideo(result)).rejects.toMatchObject({
        code: "reference_video_changed",
        retryable: false,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
