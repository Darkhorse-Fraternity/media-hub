import { describe, expect, it } from "vitest";

import { resolveMediaSystemSettingValues } from "./system-settings-policy";

describe("Media Hub system settings precedence", () => {
  it("prefers stored administrator settings over environment defaults", () => {
    expect(
      resolveMediaSystemSettingValues(
        {
          h3GenerationProfile: "settings-generate-profile",
          h3EditProfile: "settings-edit-profile",
          codexWorkerUrl: "http://settings-worker:3000",
          codexWorkerSource: "settings-source",
          codexTimeoutMs: 90_000,
          ollamaModel: "settings-model",
        },
        {
          MEDIA_HUB_H3_GENERATION_PROFILE: "env-generate-profile",
          MEDIA_HUB_H3_EDIT_PROFILE: "env-edit-profile",
          CODEX_WORKER_URL: "http://env-worker:3000",
          CODEX_WORKER_SOURCE: "env-source",
          CODEX_TIMEOUT_MS: "120000",
          OLLAMA_MODEL: "env-model",
        },
      ),
    ).toMatchObject({
      h3GenerationProfile: "settings-generate-profile",
      h3EditProfile: "settings-edit-profile",
      codexWorkerUrl: "http://settings-worker:3000",
      codexWorkerSource: "settings-source",
      codexTimeoutMs: 90_000,
      ollamaModel: "settings-model",
    });
  });

  it("falls back through environment values to safe defaults", () => {
    expect(
      resolveMediaSystemSettingValues(
        {
          h3GenerationProfile: "  ",
          h3EditProfile: null,
          codexWorkerUrl: "  ",
          ollamaModel: null,
        },
        {
          MEDIA_HUB_H3_GENERATION_PROFILE: "env-generate-profile",
          CODEX_WORKER_URL: "http://env-worker:3000",
          CODEX_TIMEOUT_MS: "invalid",
        },
      ),
    ).toEqual({
      h3GenerationProfile: "env-generate-profile",
      h3EditProfile: "platform-h3-ref2va-edit-v1",
      codexWorkerUrl: "http://env-worker:3000",
      codexWorkerSource: "knowledge-bot",
      codexTimeoutMs: 180_000,
      ollamaBaseUrl: undefined,
      ollamaModel: "qwen3-vl:32b",
    });
  });
});
