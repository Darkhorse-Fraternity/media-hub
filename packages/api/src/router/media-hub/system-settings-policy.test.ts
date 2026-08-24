import { describe, expect, it } from "vitest";

import { resolveMediaSystemSettingValues } from "./system-settings-policy";

describe("Media Hub system settings precedence", () => {
  it("prefers stored administrator settings over environment defaults", () => {
    expect(
      resolveMediaSystemSettingValues(
        {
          codexWorkerUrl: "http://settings-worker:3000",
          codexWorkerSource: "settings-source",
          codexTimeoutMs: 90_000,
          ollamaModel: "settings-model",
          feishuReviewChatId: "settings-chat",
        },
        {
          CODEX_WORKER_URL: "http://env-worker:3000",
          CODEX_WORKER_SOURCE: "env-source",
          CODEX_TIMEOUT_MS: "120000",
          OLLAMA_MODEL: "env-model",
          MEDIA_HUB_REVIEW_CHAT_ID: "env-chat",
        },
      ),
    ).toMatchObject({
      codexWorkerUrl: "http://settings-worker:3000",
      codexWorkerSource: "settings-source",
      codexTimeoutMs: 90_000,
      ollamaModel: "settings-model",
      feishuReviewChatId: "settings-chat",
    });
  });

  it("falls back through environment values to safe defaults", () => {
    expect(
      resolveMediaSystemSettingValues(
        { codexWorkerUrl: "  ", ollamaModel: null },
        {
          CODEX_WORKER_URL: "http://env-worker:3000",
          CODEX_TIMEOUT_MS: "invalid",
        },
      ),
    ).toEqual({
      codexWorkerUrl: "http://env-worker:3000",
      codexWorkerSource: "knowledge-bot",
      codexTimeoutMs: 180_000,
      ollamaBaseUrl: undefined,
      ollamaModel: "qwen3-vl:32b",
      feishuReviewChatId: undefined,
    });
  });
});
