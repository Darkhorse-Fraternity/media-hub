import { hostname } from "node:os";

import type { db as applicationDb } from "@acme/db/client";
import { and, asc, eq, lt } from "@acme/db";
import { db } from "@acme/db/client";
import {
  mediaPrevisArtifact,
  mediaPrevisRender,
  mediaPrevisRenderAttempt,
  mediaPrevisRenderItem,
  mediaPrevisRevision,
  mediaPrevisScene,
} from "@acme/db/schema";
import { deleteMediaHubObject, putMediaHubObject } from "@acme/storage";

import type { PrevisEngineOutput } from "./previs-render-engine";
import { renderPrevisItem } from "./previs-render-engine";
import { queuePrevisThumbnail } from "./previs-render-service";
import { isMediaGenerationWorkerEnabled } from "./worker-config";

type Database = typeof applicationDb;
const LEASE_MS = 45_000;
const workerId = `${hostname()}:${process.pid}:${crypto.randomUUID()}`;

/** A dead local stdio runtime cannot be resumed. Its attempt stays in history; retry is explicit. */
export async function recoverPrevisAttempts(
  database: Database,
  now = new Date(),
) {
  return database.transaction(async (tx) => {
    const stale = await tx
      .select({
        attempt: mediaPrevisRenderAttempt,
        item: mediaPrevisRenderItem,
      })
      .from(mediaPrevisRenderItem)
      .innerJoin(
        mediaPrevisRenderAttempt,
        eq(mediaPrevisRenderItem.currentAttemptId, mediaPrevisRenderAttempt.id),
      )
      .where(
        and(
          eq(mediaPrevisRenderItem.status, "running"),
          lt(mediaPrevisRenderAttempt.leaseExpiresAt, now),
        ),
      )
      .for("update", { of: mediaPrevisRenderItem, skipLocked: true });
    for (const { item, attempt } of stale) {
      const status = item.cancelRequestedAt ? "canceled" : "interrupted";
      const error = item.cancelRequestedAt
        ? "任务已取消"
        : "执行心跳中断，本地引擎任务不可续跑，请重试该条目";
      await tx
        .update(mediaPrevisRenderItem)
        .set({ status, error, updatedAt: now })
        .where(eq(mediaPrevisRenderItem.id, item.id));
      await tx
        .update(mediaPrevisRenderAttempt)
        .set({ status, error, finishedAt: now })
        .where(eq(mediaPrevisRenderAttempt.id, attempt.id));
    }
    return stale.length;
  });
}

export async function claimPrevisItem(database: Database) {
  return database.transaction(async (tx) => {
    const [item] = await tx
      .select()
      .from(mediaPrevisRenderItem)
      .where(eq(mediaPrevisRenderItem.status, "queued"))
      .orderBy(
        asc(mediaPrevisRenderItem.updatedAt),
        asc(mediaPrevisRenderItem.position),
      )
      .limit(1)
      .for("update", { skipLocked: true });
    if (!item) return null;
    const [render] = await tx
      .select()
      .from(mediaPrevisRender)
      .where(eq(mediaPrevisRender.id, item.renderId));
    if (!render) throw new Error("渲染批次缺失");
    const [revision] = await tx
      .select()
      .from(mediaPrevisRevision)
      .where(eq(mediaPrevisRevision.id, render.revisionId));
    if (!revision) throw new Error("渲染输入版本缺失");
    const attemptId = crypto.randomUUID();
    const now = new Date();
    await tx.insert(mediaPrevisRenderAttempt).values({
      id: attemptId,
      itemId: item.id,
      number: item.attemptNumber + 1,
      workerId,
      status: "running",
      heartbeatAt: now,
      leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
    });
    await tx
      .update(mediaPrevisRenderItem)
      .set({
        status: "running",
        currentAttemptId: attemptId,
        attemptNumber: item.attemptNumber + 1,
        error: null,
        updatedAt: now,
      })
      .where(eq(mediaPrevisRenderItem.id, item.id));
    return { item, render, revision, attemptId };
  });
}

export type PrevisClaim = NonNullable<
  Awaited<ReturnType<typeof claimPrevisItem>>
>;

export async function heartbeatPrevisAttempt(
  database: Database,
  claim: PrevisClaim,
) {
  return database.transaction(async (tx) => {
    const [item] = await tx
      .select()
      .from(mediaPrevisRenderItem)
      .where(eq(mediaPrevisRenderItem.id, claim.item.id))
      .for("update");
    if (
      item?.status !== "running" ||
      item.currentAttemptId !== claim.attemptId ||
      item.cancelRequestedAt
    )
      return false;
    const now = new Date();
    const [attempt] = await tx
      .select()
      .from(mediaPrevisRenderAttempt)
      .where(eq(mediaPrevisRenderAttempt.id, claim.attemptId));
    if (!attempt || attempt.leaseExpiresAt <= now) return false;
    await tx
      .update(mediaPrevisRenderAttempt)
      .set({
        heartbeatAt: now,
        leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
      })
      .where(eq(mediaPrevisRenderAttempt.id, claim.attemptId));
    return true;
  });
}

export async function publishPrevisOutput(
  database: Database,
  claim: PrevisClaim,
  output: Omit<PrevisEngineOutput, "content">,
  storageKey: string,
  sizeBytes: number,
) {
  return database.transaction(async (tx) => {
    const [item] = await tx
      .select()
      .from(mediaPrevisRenderItem)
      .where(eq(mediaPrevisRenderItem.id, claim.item.id))
      .for("update");
    const [attempt] = await tx
      .select()
      .from(mediaPrevisRenderAttempt)
      .where(eq(mediaPrevisRenderAttempt.id, claim.attemptId));
    if (
      item?.status !== "running" ||
      item.currentAttemptId !== claim.attemptId ||
      item.cancelRequestedAt ||
      !attempt ||
      attempt.leaseExpiresAt <= new Date()
    )
      return false;
    const artifactId = crypto.randomUUID();
    await tx.insert(mediaPrevisArtifact).values({
      id: artifactId,
      itemId: item.id,
      attemptId: claim.attemptId,
      revisionId: claim.revision.id,
      storageKey,
      sizeBytes,
      ...output,
    });
    if (
      claim.render.purpose === "thumbnail" &&
      output.contentType === "image/png"
    ) {
      // Derived cover completion does not change the authoring CAS version.
      await tx
        .update(mediaPrevisScene)
        .set({
          thumbnailArtifactId: artifactId,
          thumbnailRevisionId: claim.revision.id,
        })
        .where(
          and(
            eq(mediaPrevisScene.id, claim.render.sceneId),
            eq(mediaPrevisScene.thumbnailMode, "auto"),
            eq(mediaPrevisScene.headRevisionId, claim.revision.id),
          ),
        );
    }
    const now = new Date();
    await tx
      .update(mediaPrevisRenderItem)
      .set({ status: "succeeded", error: null, updatedAt: now })
      .where(eq(mediaPrevisRenderItem.id, item.id));
    await tx
      .update(mediaPrevisRenderAttempt)
      .set({ status: "succeeded", finishedAt: now, heartbeatAt: now })
      .where(eq(mediaPrevisRenderAttempt.id, claim.attemptId));
    return true;
  });
}

async function finishFailure(
  database: Database,
  claim: PrevisClaim,
  error: unknown,
) {
  await database.transaction(async (tx) => {
    const [item] = await tx
      .select()
      .from(mediaPrevisRenderItem)
      .where(eq(mediaPrevisRenderItem.id, claim.item.id))
      .for("update");
    if (item?.status !== "running" || item.currentAttemptId !== claim.attemptId)
      return;
    const status = item.cancelRequestedAt ? "canceled" : "failed";
    const message = (
      error instanceof Error ? error.message : "白模渲染失败"
    ).slice(0, 2000);
    const now = new Date();
    await tx
      .update(mediaPrevisRenderItem)
      .set({ status, error: message, updatedAt: now })
      .where(eq(mediaPrevisRenderItem.id, item.id));
    await tx
      .update(mediaPrevisRenderAttempt)
      .set({ status, error: message, finishedAt: now })
      .where(eq(mediaPrevisRenderAttempt.id, claim.attemptId));
  });
}

export async function runPrevisWorkerTick(
  database: Database,
  dependencies: {
    render?: typeof renderPrevisItem;
    put?: typeof putMediaHubObject;
    remove?: typeof deleteMediaHubObject;
    publish?: typeof publishPrevisOutput;
  } = {},
) {
  await recoverPrevisAttempts(database);
  const claim = await claimPrevisItem(database);
  if (!claim) return false;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error("白模条目超过 5 分钟执行上限")),
    5 * 60_000,
  );
  let heartbeat: Promise<void> | undefined;
  const pulse = () => {
    if (heartbeat) return;
    heartbeat = heartbeatPrevisAttempt(database, claim)
      .then((alive) => {
        if (!alive) controller.abort(new Error("任务已取消或执行租约失效"));
      })
      .catch(() => controller.abort(new Error("无法续租白模执行任务")))
      .finally(() => {
        heartbeat = undefined;
      });
  };
  const timer = setInterval(pulse, 2000);
  let stored: string | undefined;
  let publicationPending = false;
  try {
    const output = await (dependencies.render ?? renderPrevisItem)({
      recipe: claim.revision.recipe,
      spec: claim.item.spec,
      signal: controller.signal,
      onJob: async (engineJobId) => {
        await database
          .update(mediaPrevisRenderAttempt)
          .set({ engineJobId })
          .where(
            and(
              eq(mediaPrevisRenderAttempt.id, claim.attemptId),
              eq(mediaPrevisRenderAttempt.status, "running"),
            ),
          );
      },
    });
    controller.signal.throwIfAborted();
    if (!(await heartbeatPrevisAttempt(database, claim)))
      throw new Error("任务已取消或执行租约失效");
    const extension = output.contentType === "image/png" ? "png" : "mp4";
    stored = `media-hub/previs/${claim.render.ownerUserId}/${claim.render.id}/${claim.item.id}/${claim.attemptId}.${extension}`;
    await (dependencies.put ?? putMediaHubObject)(
      stored,
      output.content,
      output.contentType,
      controller.signal,
    );
    const { content, ...metadata } = output;
    publicationPending = true;
    const published = await (dependencies.publish ?? publishPrevisOutput)(
      database,
      claim,
      metadata,
      stored,
      content.length,
    );
    publicationPending = false;
    if (!published) throw new Error("过期或已取消的执行结果未发布");
    stored = undefined;
  } catch (error) {
    await finishFailure(database, claim, error);
    if (publicationPending && stored) {
      // finishFailure locks the item, so this read follows the original transaction's resolution.
      const [artifact] = await database
        .select({ id: mediaPrevisArtifact.id })
        .from(mediaPrevisArtifact)
        .where(eq(mediaPrevisArtifact.storageKey, stored))
        .limit(1);
      if (artifact) stored = undefined;
      publicationPending = false;
    }
  } finally {
    clearTimeout(timeout);
    clearInterval(timer);
    await heartbeat;
    if (stored && !publicationPending)
      await (dependencies.remove ?? deleteMediaHubObject)(stored).catch(
        (error) => console.error("白模未发布产物清理失败", error),
      );
  }
  return true;
}

let started = false;
let busy = false;
export function startPrevisScheduler() {
  if (
    started ||
    process.env.NODE_ENV === "test" ||
    process.env.MEDIA_HUB_PREVIS_ENABLED === "false" ||
    !isMediaGenerationWorkerEnabled(
      process.env.MEDIA_HUB_PREVIS_WORKER_ENABLED ??
        process.env.MEDIA_HUB_GENERATION_WORKER_ENABLED,
    )
  )
    return;
  started = true;
  const tick = () => {
    if (busy || process.env.MEDIA_HUB_PREVIS_ENABLED === "false") return;
    busy = true;
    void (async () => {
      if (!(await runPrevisWorkerTick(db)) && (await queuePrevisThumbnail(db)))
        await runPrevisWorkerTick(db);
    })()
      .catch((error) => console.error("白模执行队列错误", error))
      .finally(() => {
        busy = false;
      });
  };
  const timer = setInterval(tick, 2000);
  timer.unref();
  tick();
}
