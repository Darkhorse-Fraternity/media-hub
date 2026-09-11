const disabledWorkerValues = new Set(["0", "false", "no", "off"]);

/**
 * Generation workers are enabled by default for backward compatibility.
 * Set MEDIA_HUB_GENERATION_WORKER_ENABLED=false on every UI-only instance.
 */
export function isMediaGenerationWorkerEnabled(
  value = process.env.MEDIA_HUB_GENERATION_WORKER_ENABLED,
): boolean {
  if (value === undefined) return true;
  return !disabledWorkerValues.has(value.trim().toLowerCase());
}
