import { describe, expect, it } from "vitest";

import {
  defaultMediaPublishPlan,
  isMediaPublishPlanDue,
  normalizeMediaPublishPlan,
  readMediaPublishPlans,
  writeMediaPublishPlans,
} from "./publish-settings";

describe("media publish settings", () => {
  it("fills safe platform defaults for historical tasks", () => {
    expect(normalizeMediaPublishPlan(undefined)).toEqual(
      defaultMediaPublishPlan,
    );
    expect(defaultMediaPublishPlan.youtube.language).toBe("en");
    expect(defaultMediaPublishPlan.douyin).toEqual({
      privateStatus: 0,
      allowDownload: true,
      coverTimeSeconds: null,
    });
  });

  it("normalizes Douyin-specific publishing controls", () => {
    expect(
      normalizeMediaPublishPlan({
        douyin: {
          privateStatus: 2,
          allowDownload: false,
          coverTimeSeconds: 3.5,
        },
      }).douyin,
    ).toEqual({
      privateStatus: 2,
      allowDownload: false,
      coverTimeSeconds: 3.5,
    });
  });

  it("preserves unrelated AI prompt data when writing publish plans", () => {
    const plan = normalizeMediaPublishPlan({
      title: "Launch day",
      youtube: { privacyStatus: "unlisted" },
    });
    const updated = writeMediaPublishPlans(
      { source: "minimax-h3", prompt: "robot" },
      { accountA: plan },
    );

    expect(updated.source).toBe("minimax-h3");
    expect(readMediaPublishPlans(updated).accountA).toEqual(plan);
  });

  it("only releases scheduled plans after their due time", () => {
    const plan = normalizeMediaPublishPlan({
      scheduledAt: "2026-08-12T10:00:00.000Z",
    });

    expect(isMediaPublishPlanDue(plan, new Date("2026-08-12T09:59:59Z"))).toBe(
      false,
    );
    expect(isMediaPublishPlanDue(plan, new Date("2026-08-12T10:00:00Z"))).toBe(
      true,
    );
  });
});
