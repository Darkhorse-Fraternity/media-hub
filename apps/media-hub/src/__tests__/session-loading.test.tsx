// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SessionLoadingScreen } from "../components/media-hub-login";

vi.mock("../auth/client", () => ({ authClient: {} }));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("session loading recovery", () => {
  it("offers recovery after eight seconds without declaring the session invalid", () => {
    vi.useFakeTimers();
    const retry = vi.fn();
    render(<SessionLoadingScreen onRetry={retry} />);
    expect(screen.getByRole("status").textContent).toContain(
      "正在检查登录状态",
    );
    expect(screen.queryByRole("button")).toBeNull();
    act(() => vi.advanceTimersByTime(8000));
    expect(screen.getByRole("alert").textContent).toContain("检查耗时较长");
    fireEvent.click(screen.getByRole("button", { name: "重新检查" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("clears the pending timer when the session check completes", () => {
    vi.useFakeTimers();
    const view = render(<SessionLoadingScreen />);
    expect(vi.getTimerCount()).toBe(1);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
