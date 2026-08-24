import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod/v4";

import {
  agentJson,
  createAgentApiCaller,
  handleAgentApiError,
  readAgentJson,
} from "~/lib/agent-api";

const optimizePromptBody = z.object({
  prompt: z.string().trim().min(1).max(5000),
  language: z.enum(["zh", "en"]).default("en"),
  title: z.string().trim().max(200).optional(),
  duration_seconds: z.number().int().min(5).max(60).default(30),
  has_reference_image: z.boolean().default(false),
});

async function handlePost(request: Request): Promise<Response> {
  try {
    const { caller } = await createAgentApiCaller(request);
    const input = optimizePromptBody.parse(await readAgentJson(request));
    return agentJson(
      await caller.mediaHub.ai.optimizePrompt({
        prompt: input.prompt,
        language: input.language,
        title: input.title,
        durationSeconds: input.duration_seconds,
        hasReferenceImage: input.has_reference_image,
      }),
    );
  } catch (error) {
    return handleAgentApiError(error);
  }
}

export const Route = createFileRoute("/api/v1/prompts/optimize")({
  server: { handlers: { POST: ({ request }) => handlePost(request) } },
});
