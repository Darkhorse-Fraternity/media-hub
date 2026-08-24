type GenerationTimestamp = Date | string | null | undefined;

function toTimestamp(value: GenerationTimestamp): number | null {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

/** 将生成任务的起止时间格式化为适合队列展示的中文耗时。 */
export function formatGenerationElapsed(
  startedAt: GenerationTimestamp,
  finishedAt: GenerationTimestamp,
  now = Date.now(),
): string | null {
  const startedTimestamp = toTimestamp(startedAt);
  if (startedTimestamp === null) return null;

  const finishedTimestamp = toTimestamp(finishedAt) ?? now;
  const totalSeconds = Math.max(
    0,
    Math.floor((finishedTimestamp - startedTimestamp) / 1000),
  );
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours} 小时 ${minutes.toString().padStart(2, "0")} 分 ${seconds
      .toString()
      .padStart(2, "0")} 秒`;
  }
  if (minutes > 0) {
    return `${minutes} 分 ${seconds.toString().padStart(2, "0")} 秒`;
  }
  return `${seconds} 秒`;
}
