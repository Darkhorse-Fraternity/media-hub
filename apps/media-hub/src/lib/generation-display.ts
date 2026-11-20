import type { inferRouterOutputs } from "@trpc/server";

import type { MediaHubAppRouter } from "@acme/api";

type GenerationTimestamp = Date | string | null | undefined;
type VideoJobQueue =
  inferRouterOutputs<MediaHubAppRouter>["mediaHub"]["generation"]["getById"]["queue"];

interface VideoJobTiming {
  status: string;
  kind?: string;
  startedAt?: GenerationTimestamp;
  generationStartedAt?: GenerationTimestamp;
  finishedAt?: GenerationTimestamp;
  scheduledAt?: GenerationTimestamp;
  createdAt?: GenerationTimestamp;
  queue?: VideoJobQueue;
}

export function videoJobDisplayStatus(job: VideoJobTiming): string {
  switch (job.queue?.phase) {
    case "provider_queue":
    case "gpu_admission":
      return "waiting_for_gpu";
    case "provider_starting":
    case "processing":
    case "gpu_cleanup":
      return "running";
    default:
      return job.status;
  }
}

/** Never label time spent waiting for the Provider as inference time. */
export function formatVideoJobTiming(
  job: VideoJobTiming,
  now = Date.now(),
): string | null {
  const queueStart = job.startedAt ?? job.scheduledAt ?? job.createdAt;
  const actualStart =
    job.generationStartedAt ?? (job.kind === "assemble" ? job.startedAt : null);
  if (job.queue) {
    const { phase, aheadSegments, blockingPhase, segmentIndex, segmentCount } =
      job.queue;
    const labels = {
      scheduler: "等待 Media Hub 调度",
      provider_queue:
        aheadSegments === 0
          ? "等待渲染服务接单"
          : blockingPhase === "gpu_admission"
            ? "等待队首任务获取 GPU"
            : blockingPhase === "gpu_cleanup"
              ? "等待前一段释放 GPU"
              : "等待前面的渲染任务",
      gpu_admission: "等待分配 GPU",
      provider_starting: "正在准备生成",
      processing: actualStart ? "正在生成" : "渲染处理中",
      gpu_cleanup: "正在释放 GPU",
      provider_status_unavailable:
        job.status === "waiting_for_gpu"
          ? "等待 GPU · 排队详情暂不可用"
          : "渲染状态暂不可用",
    };
    const waiting =
      phase === "scheduler" ||
      phase === "provider_queue" ||
      phase === "gpu_admission" ||
      (phase === "provider_status_unavailable" &&
        job.status === "waiting_for_gpu");
    const elapsed =
      segmentIndex === 1 && (waiting || phase === "processing")
        ? formatGenerationElapsed(waiting ? queueStart : actualStart, null, now)
        : null;
    return [
      labels[phase],
      waiting && aheadSegments !== null ? `前面 ${aheadSegments} 段` : null,
      segmentIndex && segmentCount
        ? `第 ${segmentIndex}/${segmentCount} 段`
        : segmentCount
          ? `共 ${segmentCount} 段`
          : null,
      elapsed ? (waiting ? `已等待 ${elapsed}` : elapsed) : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  if (["queued", "waiting_for_gpu"].includes(job.status)) {
    const waiting = formatGenerationElapsed(queueStart, null, now);
    const label = job.kind === "assemble" ? "等待合成调度" : "等待 GPU";
    return waiting ? `${label} · 已等待 ${waiting}` : label;
  }
  if (job.status === "running") {
    const elapsed = formatGenerationElapsed(actualStart, null, now);
    return elapsed ? `正在生成 · ${elapsed}` : "正在准备生成";
  }
  const elapsed = formatGenerationElapsed(actualStart, job.finishedAt, now);
  if (elapsed) {
    const waiting = formatGenerationElapsed(queueStart, actualStart, now);
    return `生成耗时：${elapsed}${waiting ? ` · 排队 ${waiting}` : ""}`;
  }
  const total = formatGenerationElapsed(job.startedAt, job.finishedAt, now);
  return total ? `总耗时：${total}` : null;
}

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
