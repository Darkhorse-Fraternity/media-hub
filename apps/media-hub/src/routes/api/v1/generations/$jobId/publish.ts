import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod/v4";

import {
  agentJson,
  createAgentApiCaller,
  handleAgentApiError,
  readAgentJson,
} from "~/lib/agent-api";

const publishBody = z.object({
  targets: z
    .array(
      z.object({
        account_id: z.string().min(1),
        description: z.string().trim().max(5000).optional(),
        title: z.string().trim().max(200).optional(),
        hashtags: z.string().trim().max(500).optional(),
        scheduled_at: z.iso.datetime().nullable().optional(),
        youtube: z
          .object({
            privacy_status: z
              .enum(["public", "unlisted", "private"])
              .default("public"),
            category_id: z.string().regex(/^\d+$/).max(10).default("22"),
            language: z.string().trim().min(2).max(20).default("en"),
            made_for_kids: z.boolean().default(false),
            contains_synthetic_media: z.boolean().default(true),
            notify_subscribers: z.boolean().default(true),
          })
          .optional(),
        instagram: z
          .object({
            share_to_feed: z.boolean().default(true),
            thumb_offset_ms: z
              .number()
              .int()
              .min(0)
              .max(3_600_000)
              .nullable()
              .default(null),
          })
          .optional(),
      }),
    )
    .min(1)
    .max(20),
});

async function handlePost(request: Request, jobId: string): Promise<Response> {
  try {
    const { caller } = await createAgentApiCaller(request);
    const input = publishBody.parse(await readAgentJson(request));
    const result = await caller.mediaHub.generation.publish({
      id: jobId,
      targets: input.targets.map((target) => ({
        accountId: target.account_id,
        description: target.description,
        title: target.title,
        hashtags: target.hashtags,
        scheduledAt: target.scheduled_at ? new Date(target.scheduled_at) : null,
        youtube: target.youtube
          ? {
              privacyStatus: target.youtube.privacy_status,
              categoryId: target.youtube.category_id,
              language: target.youtube.language,
              madeForKids: target.youtube.made_for_kids,
              containsSyntheticMedia: target.youtube.contains_synthetic_media,
              notifySubscribers: target.youtube.notify_subscribers,
            }
          : undefined,
        instagram: target.instagram
          ? {
              shareToFeed: target.instagram.share_to_feed,
              thumbOffsetMs: target.instagram.thumb_offset_ms,
            }
          : undefined,
      })),
    });
    return agentJson(result, 202);
  } catch (error) {
    return handleAgentApiError(error);
  }
}

export const Route = createFileRoute("/api/v1/generations/$jobId/publish")({
  server: {
    handlers: {
      POST: ({ request, params }) => handlePost(request, params.jobId),
    },
  },
});
