import type { MediaVideoScriptShot } from "@acme/db/schema";

import { H3_AV_MAX_SHOT_SECONDS } from "./h3-native-continuation";

interface Take {
  id: string;
  scriptShotId: string | null;
  status: string;
  outputStorageKey: string | null;
}

/** Takes must be owner-filtered and ordered newest first by the caller. */
export function scriptContinuationSource(
  scriptShots: MediaVideoScriptShot[],
  shot: MediaVideoScriptShot,
  newJobIds: ReadonlyMap<string, string>,
  takes: Take[],
): string | undefined {
  const index = scriptShots.findIndex((candidate) => candidate.id === shot.id);
  const previous = scriptShots[index - 1];
  if (!previous) return undefined;
  const source =
    newJobIds.get(previous.id) ??
    takes.find(
      (take) =>
        take.scriptShotId === previous.id &&
        take.status === "succeeded" &&
        take.outputStorageKey &&
        (!previous.selectedGenerationJobId ||
          take.id === previous.selectedGenerationJobId),
    )?.id;
  if (!source)
    throw new Error(
      `镜头“${shot.title}”需要上一镜通过验收，或同时生成上一镜。`,
    );
  if (shot.durationSeconds > H3_AV_MAX_SHOT_SECONDS) {
    throw new Error(
      `原生音视频延续需保留 22 帧上下文，后续镜头最长 ${H3_AV_MAX_SHOT_SECONDS} 秒。请在导演台重新分镜。`,
    );
  }
  return source;
}
