import { describe, expect, it } from "vitest";

import {
  canManageMediaPlatformAccount,
  isMediaHubAdmin,
} from "./platform-account-access";

describe("media platform account access", () => {
  it("allows a member to manage their own platform account", () => {
    expect(
      canManageMediaPlatformAccount({
        actorUserId: "member-1",
        actorRole: "member",
        ownerUserId: "member-1",
      }),
    ).toBe(true);
  });

  it("denies a member access to another member's platform account", () => {
    expect(
      canManageMediaPlatformAccount({
        actorUserId: "member-1",
        actorRole: "member",
        ownerUserId: "member-2",
      }),
    ).toBe(false);
  });

  it("allows an admin to manage every platform account", () => {
    expect(
      canManageMediaPlatformAccount({
        actorUserId: "admin-1",
        actorRole: "admin",
        ownerUserId: "member-2",
      }),
    ).toBe(true);
    expect(isMediaHubAdmin("admin")).toBe(true);
    expect(isMediaHubAdmin("member")).toBe(false);
  });
});
