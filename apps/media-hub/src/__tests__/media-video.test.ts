import { describe, expect, it } from "vitest";

import { mediaVideoContentDisposition } from "../lib/media-video";

describe("mediaVideoContentDisposition", () => {
  it("streams video inline for playback", () => {
    expect(mediaVideoContentDisposition("job-123", false)).toBe(
      'inline; filename="media-hub-job-123.mp4"',
    );
  });

  it("returns a safe attachment filename for downloads", () => {
    expect(mediaVideoContentDisposition("job/中文?123", true)).toBe(
      'attachment; filename="media-hub-job----123.mp4"',
    );
  });
});
