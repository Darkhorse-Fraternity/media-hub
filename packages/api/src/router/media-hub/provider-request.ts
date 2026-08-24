import { Agent, fetch as undiciFetch } from "undici";

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const RETRYABLE_STATUS_CODES = new Set([408, 425, 429]);
const directProviderDispatcher = new Agent({
  connect: { timeout: DEFAULT_TIMEOUT_MS },
});

const directProviderFetch: typeof fetch = (input, init) =>
  undiciFetch(input as Parameters<typeof undiciFetch>[0], {
    ...(init as Parameters<typeof undiciFetch>[1]),
    dispatcher: directProviderDispatcher,
  }) as unknown as Promise<Response>;

export interface ProviderRequestRetryEvent {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  error: Error;
}

interface ProviderRequestOptions {
  baseUrl: string;
  token: string;
  path: string;
  init?: RequestInit;
  timeoutMs?: number;
  maxAttempts?: number;
  fetchImpl?: typeof fetch;
  sleep?: (delayMs: number) => Promise<void>;
  onRetry?: (event: ProviderRequestRetryEvent) => void;
}

export class ProviderRequestError extends Error {
  readonly status?: number;
  readonly retryable: boolean;

  constructor(
    message: string,
    options: { status?: number; retryable: boolean; cause?: unknown },
  ) {
    super(message, { cause: options.cause });
    this.name = "ProviderRequestError";
    this.status = options.status;
    this.retryable = options.retryable;
  }
}

function retryDelayMs(attempt: number): number {
  return Math.min(4_000, 500 * 2 ** (attempt - 1));
}

function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUS_CODES.has(status) || status >= 500;
}

async function responseMessage(response: Response): Promise<string> {
  const fallback = `生成服务返回 HTTP ${response.status}`;
  try {
    const body = (await response.json()) as {
      detail?: { message?: string } | string;
      message?: string;
    };
    if (typeof body.detail === "string") return body.detail;
    return body.detail?.message ?? body.message ?? fallback;
  } catch {
    return fallback;
  }
}

function normalizeTransportError(
  error: unknown,
  timeoutMs: number,
): ProviderRequestError {
  const source = error instanceof Error ? error : new Error(String(error));
  const timedOut =
    source.name === "AbortError" ||
    source.name === "TimeoutError" ||
    /abort|timeout/i.test(source.message);
  return new ProviderRequestError(
    timedOut
      ? `H3 生成链路请求超时（${Math.ceil(timeoutMs / 1000)} 秒）`
      : `H3 生成链路连接失败：${source.message}`,
    { retryable: true, cause: source },
  );
}

export async function requestGenerationProvider<T>({
  baseUrl,
  token,
  path,
  init = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  fetchImpl = directProviderFetch,
  sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
  onRetry,
}: ProviderRequestOptions): Promise<T> {
  const attempts = Math.max(1, maxAttempts);
  let lastError: ProviderRequestError | undefined;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(`${baseUrl}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          ...init.headers,
        },
        signal: init.signal ?? AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        throw new ProviderRequestError(await responseMessage(response), {
          status: response.status,
          retryable: isRetryableStatus(response.status),
        });
      }
      return (await response.json()) as T;
    } catch (error) {
      lastError =
        error instanceof ProviderRequestError
          ? error
          : normalizeTransportError(error, timeoutMs);
      if (!lastError.retryable || attempt >= attempts) throw lastError;

      const delayMs = retryDelayMs(attempt);
      onRetry?.({ attempt, maxAttempts: attempts, delayMs, error: lastError });
      await sleep(delayMs);
    }
  }

  throw (
    lastError ??
    new ProviderRequestError("H3 生成链路请求失败", { retryable: true })
  );
}
