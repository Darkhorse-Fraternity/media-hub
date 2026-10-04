import { describe, expect, it } from "vitest";

import { scriptNativeContinuityIssue } from "../lib/script-native-continuity";

describe("director native continuation readiness", () => {
  const healthy = {
    mode: "native_av" as const,
    healthStatus: "healthy",
    defaultProfile: "base",
    profiles: [
      { id: "base", supportsNativeAVContinuation: true },
      { id: "turbo", supportsNativeAVContinuation: false },
    ],
  };
  it("uses actual selected-profile capabilities without falling back to independent mode", () => {
    expect(scriptNativeContinuityIssue(healthy)).toBeNull();
    expect(
      scriptNativeContinuityIssue({ ...healthy, selectedProfile: "" }),
    ).toBeNull();
    expect(
      scriptNativeContinuityIssue({ ...healthy, selectedProfile: "turbo" }),
    ).toContain("尚未启用");
    expect(
      scriptNativeContinuityIssue({ ...healthy, selectedProfile: "missing" }),
    ).toContain("尚未启用");
    expect(
      scriptNativeContinuityIssue({ ...healthy, profiles: [{ id: "base" }] }),
    ).toContain("尚未启用");
    expect(
      scriptNativeContinuityIssue({
        ...healthy,
        selectedProfile: "turbo",
        mode: "independent",
      }),
    ).toBeNull();
  });
  it("blocks native submission while capability checking is pending or unavailable", () => {
    expect(
      scriptNativeContinuityIssue({ ...healthy, healthStatus: undefined }),
    ).toContain("正在检查");
    expect(
      scriptNativeContinuityIssue({ ...healthy, healthStatus: "unreachable" }),
    ).toContain("暂不可用");
    expect(
      scriptNativeContinuityIssue({
        ...healthy,
        healthError: "connection failed",
      }),
    ).toContain("无法检查");
  });
});
