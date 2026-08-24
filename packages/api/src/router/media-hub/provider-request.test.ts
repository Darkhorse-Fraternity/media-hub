import { createServer } from "node:http";
import { getGlobalDispatcher, ProxyAgent, setGlobalDispatcher } from "undici";
import { describe, expect, it, vi } from "vitest";

import { requestGenerationProvider } from "./provider-request";

const config = {
  baseUrl: "http://provider.test",
  token: "secret",
  path: "/healthz",
};

describe("generation provider request resilience", () => {
  it("bypasses the global proxy for private provider requests", async () => {
    const originalDispatcher = getGlobalDispatcher();
    const proxy = new ProxyAgent("http://127.0.0.1:1");
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "healthy" }));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Test server failed to start");

    setGlobalDispatcher(proxy);
    try {
      await expect(
        requestGenerationProvider<{ status: string }>({
          ...config,
          baseUrl: `http://127.0.0.1:${address.port}`,
          maxAttempts: 1,
        }),
      ).resolves.toEqual({ status: "healthy" });
    } finally {
      setGlobalDispatcher(originalDispatcher);
      await proxy.close();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("retries transient HTTP errors and then succeeds", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ detail: "busy" }), { status: 503 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "ok" }), { status: 200 }),
      );
    const sleep = vi.fn(() => Promise.resolve(undefined));

    await expect(
      requestGenerationProvider<{ status: string }>({
        ...config,
        fetchImpl,
        sleep,
      }),
    ).resolves.toEqual({ status: "ok" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(500);
  });

  it("does not retry validation and authorization errors", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ detail: { message: "invalid width" } }), {
        status: 422,
      }),
    );

    await expect(
      requestGenerationProvider({ ...config, fetchImpl, sleep: vi.fn() }),
    ).rejects.toMatchObject({
      message: "invalid width",
      retryable: false,
      status: 422,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries transport failures up to the configured limit", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("socket closed"));
    const onRetry = vi.fn();

    await expect(
      requestGenerationProvider({
        ...config,
        fetchImpl,
        maxAttempts: 3,
        sleep: vi.fn(() => Promise.resolve(undefined)),
        onRetry,
      }),
    ).rejects.toMatchObject({ retryable: true });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });
});
