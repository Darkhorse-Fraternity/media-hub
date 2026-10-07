import type { MediaVideoScriptShot } from "@acme/validators";

export function clampTime(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

export function snapTime(value: number) {
  // Divide after rounding to avoid values such as 1.2000000000000002.
  return Math.round(value * 10) / 10;
}

/** The same hard-cut offsets used by the assembly service. */
export function compositionClips(shots: MediaVideoScriptShot[]) {
  let offset = 0;
  return shots.map((shot) => {
    const source = shotPreviewRange(shot);
    const start = offset;
    offset += source.end - source.start;
    return { shot, source, start, end: offset };
  });
}

export function compositionPosition(
  clips: ReturnType<typeof compositionClips>,
  time: number,
) {
  const total = clips.at(-1)?.end ?? 0;
  const position = clampTime(time, 0, total);
  const clip = clips.find((item) => position < item.end) ?? clips.at(-1);
  return clip
    ? { clip, sourceTime: clip.source.start + position - clip.start }
    : null;
}

export function compositionCaptions(
  clips: ReturnType<typeof compositionClips>,
) {
  return clips.flatMap((clip) =>
    (clip.shot.captions ?? []).flatMap((cue) => {
      const start = Math.max(clip.source.start, cue.startSeconds);
      const end = Math.min(clip.source.end, cue.endSeconds);
      if (end - start < 0.1) return [];
      return [
        {
          ...cue,
          id: `${clip.shot.id}:${cue.id}`,
          cueId: cue.id,
          shotId: clip.shot.id,
          startSeconds: clip.start + start - clip.source.start,
          endSeconds: clip.start + end - clip.source.start,
        },
      ];
    }),
  );
}

/** Safe display bounds while the user is typing an incomplete numeric value. */
export function shotPreviewRange(shot: MediaVideoScriptShot) {
  const end = clampTime(
    shot.trimEndSeconds ?? shot.durationSeconds,
    1,
    shot.durationSeconds,
  );
  const start = clampTime(shot.trimStartSeconds ?? 0, 0, end - 1);
  return { start, end };
}

export function previewCaptions(shot: MediaVideoScriptShot, time: number) {
  const { start, end } = shotPreviewRange(shot);
  return (shot.captions ?? []).filter((cue) => {
    const cueStart = Math.max(start, cue.startSeconds);
    const cueEnd = Math.min(end, cue.endSeconds);
    return (
      cueEnd - cueStart >= 0.1 &&
      time >= cueStart &&
      time < cueEnd &&
      cue.text.trim()
    );
  });
}

/** Pack non-overlapping cues together; preserve overlapping cues on separate lanes. */
export function captionTimelineLanes(
  captions: NonNullable<MediaVideoScriptShot["captions"]>,
) {
  const lanes: { end: number; ids: string[] }[] = [];
  for (const cue of [...captions].sort(
    (a, b) => a.startSeconds - b.startSeconds,
  )) {
    const lane = lanes.find((item) => item.end <= cue.startSeconds);
    if (lane) {
      lane.end = cue.endSeconds;
      lane.ids.push(cue.id);
    } else {
      lanes.push({ end: cue.endSeconds, ids: [cue.id] });
    }
  }
  return lanes.map((lane) => lane.ids);
}

export function dragTimelineRange(
  range: { start: number; end: number },
  delta: number,
  mode: "start" | "end" | "move",
  duration: number,
  minimum: number,
) {
  if (mode === "start") {
    return {
      ...range,
      start: clampTime(snapTime(range.start + delta), 0, range.end - minimum),
    };
  }
  if (mode === "end") {
    return {
      ...range,
      end: clampTime(
        snapTime(range.end + delta),
        range.start + minimum,
        duration,
      ),
    };
  }
  const shift = clampTime(snapTime(delta), -range.start, duration - range.end);
  return { start: range.start + shift, end: range.end + shift };
}
