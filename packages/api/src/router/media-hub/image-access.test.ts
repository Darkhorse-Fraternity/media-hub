import { describe, expect, it } from "vitest";

import { canAccessMediaImageAsset } from "./image-access";

describe("media image asset access", () => {
  it("allows the owner to use their image library asset", () => {
    expect(
      canAccessMediaImageAsset({
        actorUserId: "user-1",
        ownerUserId: "user-1",
      }),
    ).toBe(true);
  });

  it("does not expose another user's asset", () => {
    expect(
      canAccessMediaImageAsset({
        actorUserId: "user-1",
        ownerUserId: "user-2",
      }),
    ).toBe(false);
  });

  it("does not implicitly grant ordinary-library access to an admin identity", () => {
    expect(
      canAccessMediaImageAsset({
        actorUserId: "admin-1",
        ownerUserId: "user-2",
      }),
    ).toBe(false);
  });
});
