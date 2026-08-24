import { describe, expect, it } from "vitest";

import {
  createVideoEditTitle,
  MAX_VIDEO_EDIT_TITLE_LENGTH,
  validateVideoEditTitle,
} from "../lib/video-edit-form";

describe("video edit title", () => {
  it("keeps the generated edit title within the API limit", () => {
    const title = createVideoEditTitle("长".repeat(200));

    expect(title).toHaveLength(MAX_VIDEO_EDIT_TITLE_LENGTH);
    expect(title.startsWith("修改：")).toBe(true);
  });

  it("returns a friendly validation message for an oversized title", () => {
    expect(validateVideoEditTitle("a".repeat(201))).toBe(
      "视频名称不能超过 200 个字符。",
    );
  });

  it("accepts a title at the API limit", () => {
    expect(validateVideoEditTitle("a".repeat(200))).toBeNull();
  });
});
