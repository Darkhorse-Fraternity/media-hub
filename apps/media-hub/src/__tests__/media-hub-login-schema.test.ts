import { describe, expect, it } from "vitest";

import { mediaHubSignInSchema } from "@acme/validators";

describe("mediaHubSignInSchema", () => {
  it("rejects an empty password", () => {
    expect(
      mediaHubSignInSchema.safeParse({
        email: "admin@punpkii.com",
        password: "",
      }).success,
    ).toBe(false);
  });

  it("rejects a password shorter than six characters", () => {
    expect(
      mediaHubSignInSchema.safeParse({
        email: "admin@punpkii.com",
        password: "12345",
      }).success,
    ).toBe(false);
  });

  it("accepts a valid email and six-character password", () => {
    expect(
      mediaHubSignInSchema.safeParse({
        email: "admin@punpkii.com",
        password: "123456",
      }).success,
    ).toBe(true);
  });
});
