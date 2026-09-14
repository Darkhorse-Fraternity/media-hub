import { describe, expect, it } from "vitest";

import {
  buildXiaohongshuPublishPackage,
  normalizeXiaohongshuHashtags,
} from "./xiaohongshu-package";

describe("Xiaohongshu publish package", () => {
  it("normalizes duplicate hashtags", () => {
    expect(normalizeXiaohongshuHashtags("#成长 亲子，#成长")).toEqual([
      "成长",
      "亲子",
    ]);
  });

  it("limits the note title to twenty Unicode characters", () => {
    const result = buildXiaohongshuPublishPackage({
      title: "孩子说桌子针对我后来他发现是底座太窄了哈哈",
      description: "一条关于反思的小故事",
      hashtags: "#童行记录",
    });
    expect(Array.from(result.title)).toHaveLength(20);
    expect(result.caption).toContain("#童行记录");
  });
});
