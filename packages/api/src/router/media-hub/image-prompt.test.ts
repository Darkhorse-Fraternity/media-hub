import { describe, expect, it } from "vitest";

import { imageFramingPrompt, imageVariationPrompt } from "./image-prompt";

describe("HiDream image prompt constraints", () => {
  it("turns square dimensions into an explicit 1:1 composition instruction", () => {
    const result = imageFramingPrompt("Keep the person", 1024, 1024);

    expect(result).toContain("strict square 1:1 canvas");
    expect(result).toContain("do not preserve a portrait or landscape crop");
  });

  it("distinguishes landscape and portrait composition", () => {
    expect(imageFramingPrompt("Scene", 1344, 768)).toContain(
      "strict landscape canvas",
    );
    expect(imageFramingPrompt("Scene", 768, 1344)).toContain(
      "strict portrait canvas",
    );
  });

  it("keeps framing constraints when adding batch diversity", () => {
    const framed = imageFramingPrompt("Portrait", 1024, 1024);
    const result = imageVariationPrompt(framed, 4, 90);

    expect(result).toContain("strict square 1:1 canvas");
    expect(result).toContain("Batch variation direction (90/100)");
  });
});
