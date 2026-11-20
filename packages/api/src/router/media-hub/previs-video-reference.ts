import { TRPCError } from "@trpc/server";

import type { db as applicationDb } from "@acme/db/client";

import {
  assertH3ReferenceVideoLength,
  inspectStoredH3ReferenceVideo,
} from "./h3-reference-video";
import { ownedPrevisArtifact } from "./previs-render-service";

export async function inspectPrevisReferenceVideo(
  database: typeof applicationDb,
  owner: string,
  artifactId: string,
  expected: { width: number; height: number },
) {
  const { artifact, item } = await ownedPrevisArtifact(
    database,
    owner,
    artifactId,
  );
  if (
    artifact.contentType !== "video/mp4" ||
    item.spec.profile !== "h3_reference"
  )
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "请使用白模工作台的 H3 参考 MP4 产物",
    });
  assertH3ReferenceVideoLength(artifact.frameCount);
  const reference = await inspectStoredH3ReferenceVideo(
    {
      storageKey: artifact.storageKey,
      name: `${artifact.id}.mp4`,
      contentType: "video/mp4",
    },
    expected,
  );
  if (reference.checksum !== artifact.checksum)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "白模产物与保存的校验和不符",
    });
  return {
    ...reference,
    artifactId: artifact.id,
    revisionId: artifact.revisionId,
  };
}
