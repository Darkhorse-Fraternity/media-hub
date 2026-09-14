import { describe, expect, it } from "vitest";

import { buildDouyinText } from "./douyin-copy";

describe("Douyin publisher copy", () => {
  it("joins title, description and hashtags without blank sections", () => {
    expect(
      buildDouyinText({
        title: "桌子针对我",
        description: "失败之后，他换了个更宽的底座。",
        hashtags: "#童行记录 #成长记录",
      }),
    ).toBe(
      "桌子针对我\n\n失败之后，他换了个更宽的底座。\n\n#童行记录 #成长记录",
    );
  });
});
