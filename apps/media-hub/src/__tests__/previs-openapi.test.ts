import { describe, expect, it } from "vitest";

import {
  previsRenderOpenApiPaths,
  previsRenderOpenApiSchemas,
} from "../lib/previs-render-openapi";

describe("previs render OpenAPI", () => {
  it("loads refined input schemas and documents public request field names", () => {
    const schema = previsRenderOpenApiSchemas.PrevisCreateRender;
    expect(schema.required).toEqual(["revision_id"]);
    expect(schema.properties).toHaveProperty("output_type");
    expect(schema.properties).toHaveProperty("view_ids");
    expect(schema.properties).not.toHaveProperty("idempotencyKey");
    expect(schema.properties).not.toHaveProperty("id");
    const paths = previsRenderOpenApiPaths({});
    expect(
      paths["/api/v1/previs/{sceneId}/renders"].post.responses,
    ).toHaveProperty("202");
    expect(
      paths["/api/v1/previs-renders/{renderId}/retry"].post.operationId,
    ).toBe("retryPrevisRender");
  });
});
