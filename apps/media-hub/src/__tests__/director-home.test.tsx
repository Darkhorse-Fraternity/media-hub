// @vitest-environment jsdom
import { isRedirect } from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LoginScreen } from "../components/media-hub-login";
import { Route as legacyRoute } from "../routes/scripts";

const { signIn } = vi.hoisted(() => ({ signIn: vi.fn() }));
vi.mock("../auth/client", () => ({
  authClient: { signIn: { email: signIn } },
}));

afterEach(cleanup);
beforeEach(() => vi.resetAllMocks());

describe("director home access", () => {
  it("redirects the old scripts entry to the homepage", () => {
    try {
      legacyRoute.options.beforeLoad?.({} as never);
      throw new Error("Expected a redirect");
    } catch (result) {
      expect(isRedirect(result)).toBe(true);
      expect(result).toMatchObject({ options: { to: "/", replace: true } });
    }
  });

  it("signs in and opens the workspace after successful authentication", async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    signIn.mockResolvedValue({ error: null });
    render(<LoginScreen onSuccess={onSuccess} />);
    expect(screen.getByRole("heading", { name: "登录导演台" })).toBeTruthy();
    await user.type(screen.getByLabelText("邮箱"), "server@example.com");
    await user.type(screen.getByLabelText("密码"), "example-password");
    await user.click(screen.getByRole("button", { name: "登录导演台" }));
    expect(signIn).toHaveBeenCalledWith({
      email: "server@example.com",
      password: "example-password",
      rememberMe: true,
    });
    expect(onSuccess).toHaveBeenCalledOnce();
  });

  it("keeps the login form available when authentication fails", async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    signIn.mockResolvedValue({ error: { message: "账号或密码不正确" } });
    render(<LoginScreen onSuccess={onSuccess} />);
    await user.type(screen.getByLabelText("邮箱"), "server@example.com");
    await user.type(screen.getByLabelText("密码"), "example-password");
    await user.click(screen.getByRole("button", { name: "登录导演台" }));
    expect(screen.getByRole("alert").textContent).toBe("账号或密码不正确");
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
