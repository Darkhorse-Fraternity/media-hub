import { describe, expect, it } from "vitest";

import {
  canonicalProviderJson,
  checksumProviderValue,
  providerOrchestrationRunId,
} from "./provider-contract";

describe("generated-media provider contract", () => {
  it("matches Python canonical JSON for nested Chinese content", () => {
    const value = { prompt: "深圳", nested: { z: 1, a: "猫" } };

    expect(canonicalProviderJson(value)).toBe(
      '{"nested":{"a":"\\u732b","z":1},"prompt":"\\u6df1\\u5733"}',
    );
    expect(checksumProviderValue(value)).toBe(
      "sha256:02cf3b06241920547854ba23b3577f2f03f67757a54cca42450440de3b9ae7ae",
    );
  });

  it("keeps ASCII generation specs stable", () => {
    expect(
      canonicalProviderJson({ profile: "h3", parameters: { fps: 24 } }),
    ).toBe('{"parameters":{"fps":24},"profile":"h3"}');
  });

  it("uses a stable provider identity within one run and a new one after retry", () => {
    const firstRun = new Date("2026-08-17T06:38:56.000Z");
    const retryRun = new Date("2026-08-17T06:45:12.000Z");

    expect(providerOrchestrationRunId("job-1", firstRun)).toBe(
      "job-1:2026-08-17T06:38:56.000Z",
    );
    expect(providerOrchestrationRunId("job-1", firstRun)).not.toBe(
      providerOrchestrationRunId("job-1", retryRun),
    );
  });
});
