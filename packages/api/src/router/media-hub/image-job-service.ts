import type { db as database } from "@acme/db/client";
import { mediaImageJob, mediaImageJobInput } from "@acme/db/schema";

import {
  HIDREAM_IMAGE_PROFILE,
  scheduleMediaImageJob,
  startMediaImageScheduler,
} from "./image-generation";

interface QueueMediaImageJobInput {
  db: typeof database;
  userId: string;
  title?: string;
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  seed?: number;
  outputCount: number;
  diversity: number;
  inputAssetIds?: string[];
  scriptId?: string;
  scriptShotId?: string;
  purpose?: "general" | "script-first-frame";
}

export async function queueMediaImageJob(input: QueueMediaImageJobInput) {
  startMediaImageScheduler();
  const id = crypto.randomUUID();
  const now = new Date();
  const inputAssetIds = input.inputAssetIds ?? [];
  const normalizedTitle = input.title?.trim();
  await input.db.transaction(async (tx) => {
    await tx.insert(mediaImageJob).values({
      id,
      scriptId: input.scriptId ?? null,
      scriptShotId: input.scriptShotId ?? null,
      purpose: input.purpose ?? "general",
      kind: inputAssetIds.length > 0 ? "edit" : "generate",
      title: normalizedTitle?.length ? normalizedTitle : null,
      prompt: input.prompt,
      negativePrompt: input.negativePrompt ?? "",
      width: input.width,
      height: input.height,
      seed: input.seed ?? null,
      outputCount: input.outputCount,
      diversity: input.diversity,
      profile: HIDREAM_IMAGE_PROFILE,
      status: "queued",
      createdBy: input.userId,
      createdAt: now,
      updatedAt: now,
    });
    if (inputAssetIds.length > 0) {
      await tx.insert(mediaImageJobInput).values(
        inputAssetIds.map((assetId, position) => ({
          id: crypto.randomUUID(),
          jobId: id,
          assetId,
          position,
          role: "reference",
        })),
      );
    }
  });
  scheduleMediaImageJob(id);
  return { id, status: "queued" as const };
}
