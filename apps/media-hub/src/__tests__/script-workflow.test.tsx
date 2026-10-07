// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useScriptWorkflow } from "../hooks/use-script-workflow";

afterEach(cleanup);

describe("script workflow dependencies", () => {
  it("propagates a required prerequisite failure and releases the workflow", async () => {
    const message = vi.fn();
    const { result } = renderHook(() => useScriptWorkflow(message));
    const failure = new Error("选片失败");
    await act(async () => {
      await expect(
        result.current.run(
          async () => {
            throw failure;
          },
          "失败",
          { throwOnError: true },
        ),
      ).rejects.toBe(failure);
    });
    expect(message).toHaveBeenCalledWith("选片失败");
    expect(result.current.pending).toBe(false);
    const next = vi.fn().mockResolvedValue(undefined);
    await act(async () => {
      await result.current.run(next, "失败");
    });
    expect(next).toHaveBeenCalledOnce();
  });

  it("rejects a required prerequisite when another action is already running", async () => {
    const { result } = renderHook(() => useScriptWorkflow(vi.fn()));
    let release: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    let first: Promise<void>;
    await act(async () => {
      first = result.current.run(() => pending, "失败");
    });
    const next = vi.fn();
    await expect(
      result.current.run(next, "失败", { throwOnError: true }),
    ).rejects.toThrow("当前操作尚未完成");
    expect(next).not.toHaveBeenCalled();
    await act(async () => {
      release();
      await first!;
    });
    expect(result.current.pending).toBe(false);
  });
});
