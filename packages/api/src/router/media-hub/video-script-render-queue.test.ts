import { afterEach, describe, expect, it, vi } from "vitest";

import { withScriptRenderSlot } from "./video-script-render-queue";

afterEach(() => vi.useRealTimers());

describe("script render admission", () => {
  it("serializes preview and cut work and rejects excess waiting work", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((done) => {
      release = done;
    });
    const running = vi.fn(async () => blocked);
    const first = withScriptRenderSlot(running);
    const waiting = Array.from({ length: 8 }, () =>
      withScriptRenderSlot(() => Promise.resolve("done")),
    );
    await expect(
      withScriptRenderSlot(() => Promise.resolve("overflow")),
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    await Promise.resolve();
    await Promise.resolve();
    expect(running).toHaveBeenCalledOnce();
    release();
    await first;
    expect(await Promise.all(waiting)).toEqual(Array(8).fill("done"));
  });

  it("releases the slot after failure", async () => {
    await expect(
      withScriptRenderSlot(() => Promise.reject(new Error("broken render"))),
    ).rejects.toThrow("broken render");
    await expect(
      withScriptRenderSlot(() => Promise.resolve("next")),
    ).resolves.toBe("next");
  });

  it("aborts timed out work and does not start an expired waiting render", async () => {
    vi.useFakeTimers();
    const first = withScriptRenderSlot(
      (signal) =>
        new Promise<void>((_, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new Error(String(signal.reason))),
            { once: true },
          );
        }),
    );
    const waitingRender = vi.fn(() => Promise.resolve("late"));
    const waiting = withScriptRenderSlot(waitingRender);
    const settled = Promise.allSettled([first, waiting]);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect((await settled).map((result) => result.status)).toEqual([
      "rejected",
      "rejected",
    ]);
    expect(waitingRender).not.toHaveBeenCalled();
  });
});
