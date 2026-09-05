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
  dialogues: z
    .array(
      z.object({
        segment: z.number().int().min(1).max(4),
        speaker_id: z.enum(["S1", "S2", "S3", "S4"]),
        language: z.enum(["zh", "en"]),
        text: z.string().trim().min(1).max(300),
      }),
    )
    .max(12)
    .default([]),
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
        dialogues: input.dialogues.map((dialogue) => ({
          segment: dialogue.segment,
          speakerId: dialogue.speaker_id,
          language: dialogue.language,
          text: dialogue.text,
        })),
      }),
    );
  } catch (error) {
    return handleAgentApiError(error);
  }
}

export const Route = createFileRoute("/api/v1/prompts/optimize")({
  server: { handlers: { POST: ({ request }) => handlePost(request) } },
});
