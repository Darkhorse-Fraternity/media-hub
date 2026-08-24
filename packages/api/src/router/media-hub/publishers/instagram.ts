// packages/api/src/router/media-hub/publishers/instagram.ts
import "../meta-proxy";

import { log } from "@acme/logger";
import { getMediaHubPresignedDownloadUrl } from "@acme/storage";

import { getValidInstagramAccessToken } from "../oauth-token-instagram";

const META_VERSION = process.env.META_API_VERSION ?? "v21.0";
const GRAPH = `https://graph.facebook.com/${META_VERSION}`;

interface PublishInstagramInput {
  accountId: string;
  videoStorageKey: string;
  title: string;
  description?: string | null;
  hashtags?: string | null;
  shareToFeed?: boolean;
  thumbOffsetMs?: number | null;
}

interface PublishInstagramResult {
  mediaId: string;
  url: string;
}

function buildCaption(
  title: string,
  description?: string | null,
  hashtags?: string | null,
): string {
  const parts = [title];
  if (description) parts.push(description);
  if (hashtags) parts.push(hashtags);
  return parts.join("\n\n");
}

async function pollContainerStatus(
  creationId: string,
  token: string,
): Promise<void> {
  const maxAttempts = 60; // 5s × 60 = 5 min
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const res = await fetch(
      `${GRAPH}/${creationId}?fields=status_code&access_token=${token}`,
    );
    if (!res.ok) {
      throw new Error(`Container status check HTTP ${res.status}`);
    }
    const data = (await res.json()) as { status_code?: string };
    const status = data.status_code;
    if (status === "FINISHED") return;
    if (status === "ERROR") {
      throw new Error(
        `Instagram container processing failed (status_code=ERROR)`,
      );
    }
    // IN_PROGRESS → keep polling
  }
  throw new Error("Instagram container processing timed out after 5 minutes");
}

export async function publishToInstagram(
  input: PublishInstagramInput,
): Promise<PublishInstagramResult> {
  const { token, igUserId } = await getValidInstagramAccessToken(
    input.accountId,
  );

  const videoUrl = await getMediaHubPresignedDownloadUrl(
    input.videoStorageKey,
    24 * 3600,
  );

  const caption = buildCaption(input.title, input.description, input.hashtags);

  const createRes = await fetch(`${GRAPH}/${igUserId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      media_type: "REELS",
      video_url: videoUrl,
      caption,
      share_to_feed: input.shareToFeed ?? true,
      ...(input.thumbOffsetMs === null || input.thumbOffsetMs === undefined
        ? {}
        : { thumb_offset: input.thumbOffsetMs }),
      access_token: token,
    }),
  });
  if (!createRes.ok) {
    const body = await createRes.text();
    log.error("Instagram media container creation failed", {
      code: "IG_CONTAINER_FAILED",
      account_id: input.accountId,
      status: createRes.status,
      body,
    });
    throw new Error(
      `Instagram container creation failed (HTTP ${createRes.status}): ${body.slice(0, 200)}`,
    );
  }
  const createJson = (await createRes.json()) as { id: string };
  const creationId = createJson.id;

  log.info("Instagram container created, polling…", {
    code: "IG_CONTAINER_CREATED",
    account_id: input.accountId,
    creation_id: creationId,
  });

  await pollContainerStatus(creationId, token);

  const publishRes = await fetch(`${GRAPH}/${igUserId}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ creation_id: creationId, access_token: token }),
  });
  if (!publishRes.ok) {
    const body = await publishRes.text();
    log.error("Instagram media_publish failed", {
      code: "IG_PUBLISH_FAILED",
      account_id: input.accountId,
      status: publishRes.status,
      body,
    });
    throw new Error(
      `Instagram publish failed (HTTP ${publishRes.status}): ${body.slice(0, 200)}`,
    );
  }
  const publishJson = (await publishRes.json()) as { id: string };
  const mediaId = publishJson.id;

  return {
    mediaId,
    url: `https://www.instagram.com/reel/${mediaId}/`,
  };
}
