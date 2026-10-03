import { TRPCError } from "@trpc/server";

import { and, eq, inArray, isNull } from "@acme/db";
import { mediaImageAsset } from "@acme/db/schema";
import {
  deleteMediaHubObject,
  getMediaHubObject,
  putMediaHubObject,
  scriptAnimaticKey,
} from "@acme/storage";

import type { MediaHubDb } from "./video-script-document";
import { requireOwnedScript } from "./video-script-document";
import { shotTrim } from "./video-script-edit-plan";
import { renderScriptAnimatic } from "./video-script-render";
import { withScriptRenderSlot } from "./video-script-render-queue";

export async function createScriptAnimatic(
  database: MediaHubDb,
  userId: string,
  scriptId: string,
) {
  const script = await requireOwnedScript(database, userId, scriptId);
  const assetIds = script.shots.map((shot) => shot.firstFrameAssetId);
  if (!script.shots.length || assetIds.some((id) => !id)) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "每个镜头都要先选定首帧，才能生成分镜预演",
    });
  }
  const assets = await database.query.mediaImageAsset.findMany({
    where: and(
      inArray(
        mediaImageAsset.id,
        assetIds.filter((id): id is string => Boolean(id)),
      ),
      eq(mediaImageAsset.ownerUserId, userId),
      isNull(mediaImageAsset.deletedAt),
    ),
  });
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const inputs = assetIds.map((id) => {
    const asset = id ? byId.get(id) : undefined;
    if (!asset)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "首帧素材不存在，请重新选择",
      });
    return (signal: AbortSignal) => () =>
      getMediaHubObject(asset.storageKey, signal);
  });
  const requireCurrentVersion = async () => {
    const current = await requireOwnedScript(database, userId, scriptId);
    if (current.version !== script.version) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "制作预演期间脚本已修改，请重新生成",
      });
    }
  };
  const storageKey = scriptAnimaticKey(userId, scriptId, script.version);
  await withScriptRenderSlot(async (signal) => {
    await requireCurrentVersion();
    const video = await renderScriptAnimatic(
      inputs.map((input) => input(signal)),
      script.shots,
      script.width,
      script.height,
      signal,
    );
    await requireCurrentVersion();
    signal.throwIfAborted();
    await putMediaHubObject(storageKey, video, "video/mp4", signal);
    try {
      // An edit or deletion during the upload must not leave an orphan preview.
      await requireCurrentVersion();
    } catch (error) {
      await deleteMediaHubObject(storageKey);
      throw error;
    }
  });
  return {
    version: script.version,
    durationSeconds: script.shots.reduce(
      (sum, shot) => sum + shotTrim(shot).duration,
      0,
    ),
    videoUrl: `/api/media-hub/scripts/${encodeURIComponent(scriptId)}/animatic/${script.version}/video`,
    agentVideoUrl: `/api/v1/scripts/${encodeURIComponent(scriptId)}/animatic/${script.version}/video`,
  };
}
