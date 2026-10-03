import { TRPCError } from "@trpc/server";

const RENDER_TIMEOUT_MS = 5 * 60_000;
const MAX_WAITING_RENDERS = 8;
let tail: Promise<unknown> = Promise.resolve();
let pending = 0;

/** Bound CPU and temporary-file use across previews and cuts in this worker. */
export async function withScriptRenderSlot<T>(
  render: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (pending >= MAX_WAITING_RENDERS + 1) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "视频处理队列已满，请稍后重试",
    });
  }
  pending++;
  const controller = new AbortController();
  const expiresAt = Date.now() + RENDER_TIMEOUT_MS;
  const timeout = setTimeout(
    () => controller.abort(new Error("视频处理超时，请重试")),
    RENDER_TIMEOUT_MS,
  );
  timeout.unref();
  const task = tail
    .catch(() => undefined)
    .then(() => {
      if (Date.now() >= expiresAt)
        controller.abort(new Error("视频处理超时，请重试"));
      controller.signal.throwIfAborted();
      return render(controller.signal);
    });
  tail = task.catch(() => undefined);
  try {
    return await task;
  } finally {
    clearTimeout(timeout);
    pending--;
  }
}
