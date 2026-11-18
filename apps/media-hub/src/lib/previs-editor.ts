import type { MediaPrevisRecipe } from "@acme/validators";

type Motion = NonNullable<MediaPrevisRecipe["motion"]>;
type Track = Motion["tracks"][number];
type Vector = [number, number, number];

export function previsTrackOrigin(
  motion: Motion | undefined,
  match: (track: Track) => boolean,
  fallback: Vector,
): Vector {
  const value = motion?.tracks.find(match)?.keyframes[0]?.value;
  return Array.isArray(value) && value.length === 3 ? value : fallback;
}

export function movePrevisTrack(
  motion: Motion | undefined,
  match: (track: Track) => boolean,
  from: Vector,
  to: Vector,
): Motion | undefined {
  if (!motion?.tracks.some(match)) return motion;
  const delta = [to[0] - from[0], to[1] - from[1], to[2] - from[2]] as const;
  return {
    ...motion,
    tracks: motion.tracks.map((track) =>
      match(track)
        ? {
            ...track,
            keyframes: track.keyframes.map((key) => {
              const { value } = key;
              if (!Array.isArray(value) || value.length !== 3) return key;
              return {
                ...key,
                value: [
                  value[0] + delta[0],
                  value[1] + delta[1],
                  value[2] + delta[2],
                ],
              };
            }),
          }
        : track,
    ),
  };
}

/** Match the JSON transport: optional undefined fields are omitted by Crucible. */
export function previsEngineRecipe(
  recipe: MediaPrevisRecipe,
): MediaPrevisRecipe {
  return JSON.parse(JSON.stringify(recipe)) as MediaPrevisRecipe;
}
export function filterPrevisMotion(
  motion: Motion | undefined,
  keep: (track: Motion["tracks"][number]) => boolean,
) {
  if (!motion) return undefined;
  const tracks = motion.tracks.filter(keep);
  return tracks.length ? { ...motion, tracks } : undefined;
}
export function resizePrevisMotion(
  motion: Motion | undefined,
  duration: number,
) {
  if (!motion) return undefined;
  const ratio = duration / motion.duration;
  return {
    ...motion,
    duration,
    tracks: motion.tracks.map((track) => ({
      ...track,
      keyframes: track.keyframes.map((key) => {
        const tangent = (value: typeof key.inTangent) =>
          typeof value === "number"
            ? value / ratio
            : (value?.map((n) => n / ratio) as typeof value);
        return {
          ...key,
          time: key.time * ratio,
          inTangent: tangent(key.inTangent),
          outTangent: tangent(key.outTangent),
        };
      }),
    })),
  };
}

export const previsStarterRecipe: MediaPrevisRecipe = {
  format: "crucible.scene",
  schemaVersion: 1,
  geometries: [
    { id: "box", type: "box", bevel: 0 },
    { id: "sphere", type: "sphere", segments: 24, rings: 16 },
    { id: "cylinder", type: "cylinder", segments: 24 },
  ],
  materials: [
    { id: "white", color: [0.78, 0.8, 0.84] },
    { id: "actor", color: [0.37, 0.63, 0.84] },
    { id: "wall", color: [0.52, 0.55, 0.6] },
  ],
  nodes: [
    {
      id: "floor",
      label: "地面",
      geometry: "box",
      material: "white",
      translation: [0, -0.1, 0],
      scale: [8, 0.2, 6],
    },
    {
      id: "subject",
      label: "主体",
      geometry: "sphere",
      material: "actor",
      translation: [-2, 0.7, 0],
      scale: [0.7, 0.7, 0.7],
    },
    {
      id: "occluder",
      label: "遮挡物",
      geometry: "box",
      material: "wall",
      translation: [0, 0.8, 1],
      scale: [1, 1.6, 0.3],
    },
  ],
  camera: { eye: [4, 3, 8], target: [0, 0.5, 0], fov: 45 },
  motion: {
    duration: 5,
    loop: false,
    tracks: [
      {
        kind: "node",
        id: "subject",
        property: "translation",
        keyframes: [
          { time: 0, value: [-2, 0.7, 0] },
          { time: 5, value: [2, 0.7, 0] },
        ],
      },
    ],
  },
};

export function previsNodeChanges(
  before: MediaPrevisRecipe,
  after: MediaPrevisRecipe,
) {
  const previous = new Map(before.nodes.map((node) => [node.id, node]));
  const next = new Map(after.nodes.map((node) => [node.id, node]));
  return [...new Set([...previous.keys(), ...next.keys()])].flatMap((id) => {
    const a = previous.get(id),
      b = next.get(id);
    return JSON.stringify(a) === JSON.stringify(b)
      ? []
      : [{ id, kind: !a ? "新增" : !b ? "移除" : "修改" }];
  });
}
