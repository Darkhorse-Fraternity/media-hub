import { describe, expect, it } from "vitest";

import { patchScriptBody } from "../lib/agent-video-script";

describe("agent video script PATCH schema", () => {
  it("does not inject create defaults into an omitted PATCH field", () => {
    expect(
      patchScriptBody.parse({ version: 3, copy_status: "approved" }),
    ).toEqual({ version: 3, copy_status: "approved" });
  });
});
