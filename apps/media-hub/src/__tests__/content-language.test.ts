import { describe, expect, it } from "vitest";

import {
  createMediaGenerationSchema,
  optimizeMediaImagePromptSchema,
  optimizeMediaPromptSchema,
} from "@acme/validators";

import {
  contentLanguageStorageKey,
  defaultContentLanguage,
  parseContentLanguage,
} from "../lib/content-language";

describe("content language preference", () => {
  it("defaults missing or invalid values to English", () => {
    expect(defaultContentLanguage).toBe("en");
    expect(parseContentLanguage(null)).toBe("en");
    expect(parseContentLanguage("invalid")).toBe("en");
  });

  it("restores a saved Chinese preference", () => {
    expect(parseContentLanguage("zh")).toBe("zh");
    expect(parseContentLanguage("en")).toBe("en");
  });

  it("isolates preferences by user", () => {
    expect(contentLanguageStorageKey("user-1")).toBe(
      "media-hub:content-language:user-1",
    );
    expect(contentLanguageStorageKey("user-2")).not.toBe(
      contentLanguageStorageKey("user-1"),
    );
  });

  it("uses English for omitted generation and optimization languages", () => {
    expect(
      createMediaGenerationSchema.parse({ prompt: "A robot" }).language,
    ).toBe("en");
    expect(
      optimizeMediaPromptSchema.parse({
        prompt: "A robot",
        durationSeconds: 30,
      }).language,
    ).toBe("en");
    expect(
      optimizeMediaImagePromptSchema.parse({
        prompt: "A robot portrait",
        width: 1024,
        height: 1024,
      }).language,
    ).toBe("en");
  });
});
