import { describe, expect, it } from "vitest";

import { mediaGenerationListSchema } from "@acme/validators";

describe("mediaGenerationListSchema", () => {
  it("accepts grouped statuses for paginated dashboard queries", () => {
    const result = mediaGenerationListSchema.safeParse({
      page: 2,
      pageSize: 10,
      statuses: ["succeeded", "failed", "canceled"],
    });

    expect(result.success).toBe(true);
  });

  it("rejects an empty grouped status filter", () => {
    expect(mediaGenerationListSchema.safeParse({ statuses: [] }).success).toBe(
      false,
    );
  });
});
