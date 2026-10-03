import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  deleteMediaHubObjectsByPrefix,
  scriptAnimaticKey,
  scriptAnimaticPrefix,
} from "./index";

const send = vi.hoisted(() => vi.fn());
vi.mock("@aws-sdk/client-s3", async (original) => ({
  ...(await original<typeof import("@aws-sdk/client-s3")>()),
  S3Client: class {
    send = send;
  },
}));

beforeEach(() => {
  send.mockReset();
  Object.assign(process.env, {
    MEDIA_HUB_S3_ACCESS_KEY: "test",
    MEDIA_HUB_S3_SECRET_KEY: "test",
    MEDIA_HUB_S3_BUCKET: "test",
  });
});

describe("script artifact cleanup", () => {
  it("isolates preview objects by owner, script, and version", () => {
    expect(scriptAnimaticKey("owner", "script", 2)).toBe(
      "media-hub/animatics/owner/script/preview-2.mp4",
    );
    expect(scriptAnimaticKey("owner", "script", 2)).not.toBe(
      scriptAnimaticKey("other", "script", 2),
    );
    expect(scriptAnimaticPrefix("owner", "script")).toBe(
      "media-hub/animatics/owner/script/",
    );
  });

  it("removes every version and the legacy preview across storage pages", async () => {
    const prefix = scriptAnimaticPrefix("owner", "script");
    send
      .mockResolvedValueOnce({
        Contents: [
          { Key: `${prefix}preview.mp4` },
          { Key: `${prefix}preview-1.mp4` },
        ],
        IsTruncated: true,
        NextContinuationToken: "next",
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        Contents: [{ Key: `${prefix}preview-2.mp4` }],
        IsTruncated: false,
      })
      .mockResolvedValueOnce({});
    await deleteMediaHubObjectsByPrefix(prefix);
    expect(send.mock.calls.map(([command]) => command.input)).toEqual([
      { Bucket: "test", Prefix: prefix, ContinuationToken: undefined },
      { Bucket: "test", Key: `${prefix}preview.mp4` },
      { Bucket: "test", Key: `${prefix}preview-1.mp4` },
      { Bucket: "test", Prefix: prefix, ContinuationToken: "next" },
      { Bucket: "test", Key: `${prefix}preview-2.mp4` },
    ]);
  });

  it("surfaces deletion failure so the caller can retry cleanup", async () => {
    send
      .mockResolvedValueOnce({ Contents: [{ Key: "preview" }] })
      .mockRejectedValueOnce(new Error("storage unavailable"));
    await expect(
      deleteMediaHubObjectsByPrefix(scriptAnimaticPrefix("owner", "script")),
    ).rejects.toThrow("storage unavailable");
  });
});
