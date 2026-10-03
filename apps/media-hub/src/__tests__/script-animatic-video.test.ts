import { beforeEach, describe, expect, it, vi } from "vitest";

import { serveOwnedAnimatic } from "../lib/script-animatic-video";

const mocks = vi.hoisted(() => ({ script: vi.fn(), object: vi.fn() }));
vi.mock("@acme/db/client", () => ({
  db: { query: { mediaVideoScript: { findFirst: mocks.script } } },
}));
vi.mock("@acme/storage", async (original) => ({
  ...(await original<typeof import("@acme/storage")>()),
  getMediaHubObjectResponse: mocks.object,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.script.mockResolvedValue({ version: 2 });
  mocks.object.mockResolvedValue({
    body: "v2",
    contentType: "video/mp4",
    contentLength: 2,
    contentRange: null,
  });
});

describe("versioned animatic playback", () => {
  it("looks up the exact version key, never the legacy shared preview", async () => {
    const response = await serveOwnedAnimatic(
      new Request("http://test"),
      "owner",
      "script",
      "2",
    );
    expect(response.status).toBe(200);
    expect(mocks.object).toHaveBeenCalledWith(
      "media-hub/animatics/owner/script/preview-2.mp4",
      undefined,
    );
    expect(await response.text()).toBe("v2");
  });
  it("rejects obsolete versions and inaccessible scripts before accessing storage", async () => {
    expect(
      (
        await serveOwnedAnimatic(
          new Request("http://test"),
          "owner",
          "script",
          "1",
        )
      ).status,
    ).toBe(404);
    mocks.script.mockResolvedValue(undefined);
    expect(
      (
        await serveOwnedAnimatic(
          new Request("http://test"),
          "other",
          "script",
          "2",
        )
      ).status,
    ).toBe(404);
    expect(mocks.object).not.toHaveBeenCalled();
  });
  it("does not serve the old preview through a new version URL", async () => {
    mocks.object.mockRejectedValue(
      Object.assign(new Error("missing v2"), { name: "NoSuchKey" }),
    );
    expect(
      (
        await serveOwnedAnimatic(
          new Request("http://test"),
          "owner",
          "script",
          "2",
        )
      ).status,
    ).toBe(404);
  });
  it("supports partial playback and maps an unsatisfiable range to 416", async () => {
    mocks.object.mockResolvedValue({
      body: "v",
      contentType: "video/mp4",
      contentLength: 1,
      contentRange: "bytes 0-0/2",
    });
    const response = await serveOwnedAnimatic(
      new Request("http://test", { headers: { range: "bytes=0-0" } }),
      "owner",
      "script",
      "2",
    );
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 0-0/2");
    mocks.object.mockRejectedValue(
      Object.assign(new Error("range"), { name: "InvalidRange" }),
    );
    expect(
      (
        await serveOwnedAnimatic(
          new Request("http://test", { headers: { range: "bytes=999-" } }),
          "owner",
          "script",
          "2",
        )
      ).status,
    ).toBe(416);
  });
  it("rejects malformed ranges and invalid versions", async () => {
    expect(
      (
        await serveOwnedAnimatic(
          new Request("http://test"),
          "owner",
          "script",
          "NaN",
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await serveOwnedAnimatic(
          new Request("http://test", { headers: { range: "bytes=0-1,3-4" } }),
          "owner",
          "script",
          "2",
        )
      ).status,
    ).toBe(416);
    expect(mocks.object).not.toHaveBeenCalled();
  });
});
