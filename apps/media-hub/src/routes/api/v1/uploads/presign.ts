import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod/v4";

import { putMediaHubObject } from "@acme/storage";

import {
  AgentApiError,
  agentJson,
  createAgentApiCaller,
  handleAgentApiError,
  readAgentJson,
} from "~/lib/agent-api";

const presignBody = z.object({
  filename: z.string().trim().min(1).max(255),
  content_type: z.enum(["image/jpeg", "image/png", "image/webp"]),
  size_bytes: z.number().int().positive().max(5_000_000),
  content_base64: z.string().max(7_000_000).optional(),
});

async function handlePost(request: Request): Promise<Response> {
  try {
    const { caller } = await createAgentApiCaller(request);
    const input = presignBody.parse(await readAgentJson(request));
    const result = await caller.mediaHub.upload.presign({
      kind: "cover",
      filename: input.filename,
      contentType: input.content_type,
      sizeBytes: input.size_bytes,
    });
    if (input.content_base64) {
      const content = Buffer.from(input.content_base64, "base64");
      if (content.byteLength !== input.size_bytes) {
        throw new AgentApiError(
          400,
          "content_base64 size does not match size_bytes",
          "validation_error",
        );
      }
      await putMediaHubObject(result.key, content, result.contentType);
    }
    return agentJson(
      {
        storage_key: result.key,
        upload_url: input.content_base64 ? null : result.url,
        uploaded: Boolean(input.content_base64),
        content_type: result.contentType,
        expires_in: result.expiresIn,
      },
      201,
    );
  } catch (error) {
    return handleAgentApiError(error);
  }
}

export const Route = createFileRoute("/api/v1/uploads/presign")({
  server: { handlers: { POST: ({ request }) => handlePost(request) } },
});
