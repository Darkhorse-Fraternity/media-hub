import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import { Agent, fetch as undiciFetch } from "undici";

import { log } from "@acme/logger";

const brokerDispatcher = new Agent({
  connect: { timeout: 10_000 },
});

interface BrokerLease {
  lease_id: string;
  request_id: string;
  lease_token: string;
  gpu_id: string;
  expires_at: number;
}

interface BrokerAcquireResult {
  status: "granted" | "waiting" | "released" | "expired" | "cancelled";
  request_id: string;
  lease?: BrokerLease;
  request?: { position?: number; wait_seconds?: number };
}

export interface GenerationGpuLease {
  requestId: string;
  leaseId: string;
  leaseToken: string;
  gpuId: string;
}

export class GpuBrokerError extends Error {
  readonly code: string;
  readonly failureStage = "gpu_scheduling";
  readonly retryable: boolean;

  constructor(
    message: string,
    options: { code?: string; retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "GpuBrokerError";
    this.code = options.code ?? "gpu_broker_failed";
    this.retryable = options.retryable ?? true;
  }
}

function optionalSecret(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === "" ? undefined : trimmed;
}

function brokerConfig(): { baseUrl: string; token?: string } | null {
  const baseUrl = process.env.MEDIA_HUB_GPU_BROKER_URL?.trim();
  if (!baseUrl) return null;
  let token = optionalSecret(process.env.MEDIA_HUB_GPU_BROKER_TOKEN);
  const tokenFile = process.env.MEDIA_HUB_GPU_BROKER_TOKEN_FILE?.trim();
  if (!token && tokenFile) {
    try {
      token = optionalSecret(readFileSync(tokenFile, "utf8"));
    } catch (error) {
      throw new GpuBrokerError("无法读取 GPU Broker 服务凭据", {
        code: "gpu_broker_token_unreadable",
        retryable: false,
        cause: error,
      });
    }
  }
  return {
    baseUrl: baseUrl.replace(/\/$/, ""),
    token,
  };
}

async function brokerRequest<T>(
  path: string,
  init: { method?: "GET" | "POST"; body?: string; signal?: AbortSignal } = {},
): Promise<T> {
  const config = brokerConfig();
  if (!config) {
    throw new GpuBrokerError("GPU Broker 未配置", {
      code: "gpu_broker_not_configured",
      retryable: false,
    });
  }
  let response: Response;
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
  };
  if (config.token) headers.authorization = `Bearer ${config.token}`;
  try {
    response = (await undiciFetch(`${config.baseUrl}${path}`, {
      ...init,
      dispatcher: brokerDispatcher,
      headers,
      signal: init.signal ?? AbortSignal.timeout(15_000),
    })) as unknown as Response;
  } catch (error) {
    throw new GpuBrokerError(
      `GPU Broker 连接失败：${error instanceof Error ? error.message : String(error)}`,
      { code: "gpu_broker_unavailable", cause: error },
    );
  }
  const payload = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok) {
    const message =
      typeof payload.message === "string"
        ? payload.message
        : response.statusText;
    const code =
      typeof payload.error === "string"
        ? payload.error
        : `gpu_broker_http_${response.status}`;
    throw new GpuBrokerError(`GPU Broker 拒绝请求：${message}`, {
      code,
      retryable: response.status >= 500 || response.status === 429,
    });
  }
  return payload as T;
}

export function generationGpuRequestId(jobId: string): string {
  return `media-hub:h3:${jobId}`;
}

function grantedLease(result: BrokerAcquireResult): GenerationGpuLease | null {
  if (result.status !== "granted" || !result.lease) return null;
  return {
    requestId: result.request_id,
    leaseId: result.lease.lease_id,
    leaseToken: result.lease.lease_token,
    gpuId: result.lease.gpu_id,
  };
}

export async function acquireGenerationGpuLease(input: {
  jobId: string;
  kind: string;
  durationSeconds: number;
  isStillWaiting: () => Promise<boolean>;
  onWaiting?: (input: { position: number | null; waitSeconds: number }) => void;
}): Promise<GenerationGpuLease | null> {
  if (!brokerConfig()) return null;
  const requestId = generationGpuRequestId(input.jobId);
  let result = await brokerRequest<BrokerAcquireResult>("/v1/acquire", {
    method: "POST",
    body: JSON.stringify({
      client_id: `media-hub@${hostname()}`,
      service: "h3",
      priority: "P2",
      request_id: requestId,
      wait_seconds: 10,
      metadata: {
        job_id: input.jobId,
        kind: input.kind,
        duration_seconds: input.durationSeconds,
      },
    }),
  });

  while (true) {
    const lease = grantedLease(result);
    if (lease) return lease;
    if (!["waiting"].includes(result.status)) {
      throw new GpuBrokerError(`GPU Broker 请求已结束：${result.status}`, {
        code: `gpu_broker_request_${result.status}`,
      });
    }
    input.onWaiting?.({
      position: result.request?.position ?? null,
      waitSeconds: result.request?.wait_seconds ?? 0,
    });
    if (!(await input.isStillWaiting())) {
      try {
        await cancelGenerationGpuRequest(requestId);
      } catch (error) {
        log.warn("Canceled Media Hub job left a Broker request to expire", {
          code: "GPU_BROKER_CANCEL_FAILED",
          request_id: requestId,
          err: error instanceof Error ? error : new Error(String(error)),
        });
      }
      return null;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    result = await brokerRequest<BrokerAcquireResult>(
      `/v1/acquire/${encodeURIComponent(requestId)}`,
    );
  }
}

export async function heartbeatGenerationGpuLease(
  lease: GenerationGpuLease,
): Promise<void> {
  await brokerRequest("/v1/heartbeat", {
    method: "POST",
    body: JSON.stringify({
      lease_id: lease.leaseId,
      lease_token: lease.leaseToken,
      ttl_seconds: 90,
    }),
  });
}

export async function releaseGenerationGpuLease(
  lease: GenerationGpuLease,
): Promise<void> {
  await brokerRequest("/v1/release", {
    method: "POST",
    body: JSON.stringify({
      lease_id: lease.leaseId,
      lease_token: lease.leaseToken,
    }),
  });
}

export async function cancelGenerationGpuRequest(
  requestId: string,
): Promise<void> {
  await brokerRequest("/v1/cancel", {
    method: "POST",
    body: JSON.stringify({ request_id: requestId }),
  });
}

export function startGenerationGpuHeartbeat(lease: GenerationGpuLease): {
  assertHealthy: () => void;
  stop: () => Promise<void>;
} {
  let stopped = false;
  let pending: Promise<void> | null = null;
  let error: GpuBrokerError | null = null;
  let consecutiveFailures = 0;
  const beat = () => {
    if (stopped || pending) return;
    pending = heartbeatGenerationGpuLease(lease)
      .then(() => {
        consecutiveFailures = 0;
      })
      .catch((cause: unknown) => {
        consecutiveFailures += 1;
        log.warn("GPU Broker heartbeat failed", {
          code: "GPU_BROKER_HEARTBEAT_FAILED",
          lease_id: lease.leaseId,
          consecutive_failures: consecutiveFailures,
          err: cause instanceof Error ? cause : new Error(String(cause)),
        });
        if (consecutiveFailures >= 3) {
          error = new GpuBrokerError("GPU 租约心跳连续失败，已停止生成", {
            code: "gpu_lease_lost",
            cause,
          });
        }
      })
      .finally(() => {
        pending = null;
      });
  };
  const timer = setInterval(beat, 20_000);
  timer.unref();
  return {
    assertHealthy: () => {
      if (error) throw error;
    },
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      await pending?.catch(() => undefined);
    },
  };
}
