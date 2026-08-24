import { createHash } from "node:crypto";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

/** 与 Python json.dumps(sort_keys=True, separators=(",", ":")) 保持一致。 */
export function canonicalProviderJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
    .split("")
    .map((character) => {
      const code = character.charCodeAt(0);
      return code > 0x7f
        ? `\\u${code.toString(16).padStart(4, "0")}`
        : character;
    })
    .join("");
}

export function checksumProviderValue(value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(canonicalProviderJson(value))
    .digest("hex")}`;
}

/**
 * Provider jobs are idempotent per orchestration run and attempt. A manual
 * retry starts a new run, while transport retries within that run keep the
 * same identity and safely resolve to the same provider job.
 */
export function providerOrchestrationRunId(
  jobId: string,
  startedAt: Date,
): string {
  return `${jobId}:${startedAt.toISOString()}`;
}
