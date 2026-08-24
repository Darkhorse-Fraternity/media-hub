export interface StoredMediaSystemSetting {
  codexWorkerUrl?: string | null;
  codexWorkerSource?: string | null;
  codexTimeoutMs?: number | null;
  ollamaBaseUrl?: string | null;
  ollamaModel?: string | null;
  feishuReviewChatId?: string | null;
}

function clean(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  return normalized;
}

function positiveInteger(
  value: number | string | null | undefined,
  fallback: number,
): number {
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed > 0) return parsed;
  return fallback;
}

export function resolveMediaSystemSettingValues(
  stored: StoredMediaSystemSetting | undefined,
  environment: NodeJS.ProcessEnv,
) {
  return {
    codexWorkerUrl:
      clean(stored?.codexWorkerUrl) ?? clean(environment.CODEX_WORKER_URL),
    codexWorkerSource:
      clean(stored?.codexWorkerSource) ??
      clean(environment.CODEX_WORKER_SOURCE) ??
      "knowledge-bot",
    codexTimeoutMs: positiveInteger(
      stored?.codexTimeoutMs ?? environment.CODEX_TIMEOUT_MS,
      180_000,
    ),
    ollamaBaseUrl:
      clean(stored?.ollamaBaseUrl) ?? clean(environment.OLLAMA_BASE_URL),
    ollamaModel:
      clean(stored?.ollamaModel) ??
      clean(environment.OLLAMA_MODEL) ??
      "qwen3-vl:32b",
    feishuReviewChatId:
      clean(stored?.feishuReviewChatId) ??
      clean(environment.MEDIA_HUB_REVIEW_CHAT_ID),
  };
}
