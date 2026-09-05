import { describe, expect, it } from "vitest";

import { generationGpuRequestId } from "./gpu-resource-broker";

describe("Media Hub GPU Broker contract", () => {
  it("uses a stable namespaced request id across process restarts", () => {
    expect(generationGpuRequestId("job-123")).toBe("media-hub:h3:job-123");
    expect(generationGpuRequestId("job-123")).toBe(
      generationGpuRequestId("job-123"),
    );
  });
});
