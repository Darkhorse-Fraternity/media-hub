import type {
  MediaVideoScriptCaption,
  MediaVideoScriptShot,
} from "@acme/db/schema";

export function shotTrim(shot: MediaVideoScriptShot) {
  const start = shot.trimStartSeconds ?? 0;
  const end = shot.trimEndSeconds ?? shot.durationSeconds;
  if (start < 0 || end > shot.durationSeconds || end - start < 1) {
    throw new Error(`镜头“${shot.title}”的裁切范围无效`);
  }
  return { start, end, duration: end - start };
}

export function captionsFromDialogues(
  shot: MediaVideoScriptShot,
): MediaVideoScriptCaption[] {
  const lines = [...shot.dialogues].sort((a, b) => a.atSeconds - b.atSeconds);
  return lines.map((line, index) => ({
    id: crypto.randomUUID(),
    startSeconds: line.atSeconds,
    endSeconds: Math.min(
      shot.durationSeconds,
      line.atSeconds + 3,
      Math.max(
        line.atSeconds + 0.5,
        (lines[index + 1]?.atSeconds ?? shot.durationSeconds) - 0.1,
      ),
    ),
    text: line.text,
  }));
}

export function cutCaptionCues(
  shots: MediaVideoScriptShot[],
  overlapSeconds = 0,
) {
  const result: { startSeconds: number; endSeconds: number; text: string }[] =
    [];
  let offset = 0;
  for (const shot of shots) {
    const trim = shotTrim(shot);
    for (const caption of shot.captions ?? []) {
      const start = Math.max(caption.startSeconds, trim.start);
      const end = Math.min(caption.endSeconds, trim.end);
      if (end - start < 0.1 || !caption.text.trim()) continue;
      result.push({
        startSeconds: offset + start - trim.start,
        endSeconds: offset + end - trim.start,
        text: caption.text.trim(),
      });
    }
    offset += trim.duration - overlapSeconds;
  }
  return result;
}

function srtTime(seconds: number): string {
  const milliseconds = Math.round(seconds * 1000);
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((milliseconds % 60_000) / 1000);
  const millis = milliseconds % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

export function captionsToSrt(
  shots: MediaVideoScriptShot[],
  overlapSeconds = 0,
): string {
  return cutCaptionCues(shots, overlapSeconds)
    .map(
      (cue, index) =>
        `${index + 1}\n${srtTime(cue.startSeconds)} --> ${srtTime(cue.endSeconds)}\n${cue.text.replace(/\r/g, "").replace(/\n+/g, " ")}\n`,
    )
    .join("\n");
}
