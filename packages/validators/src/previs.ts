import { z } from "zod/v4";

export const MEDIA_PREVIS_ENGINE_VERSION = "0.20.0";
export const MEDIA_PREVIS_MAX_RECIPE_BYTES = 262_144;

export type MediaPrevisJsonValue =
  | string
  | number
  | boolean
  | null
  | MediaPrevisJsonValue[]
  | { [key: string]: MediaPrevisJsonValue };
const jsonValue: z.ZodType<MediaPrevisJsonValue> = z.json();

const identifier = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
const position = z.number().finite().min(-10_000).max(10_000);
const vector = z.tuple([position, position, position]);
const positive = z.number().finite().min(0.001).max(1_000);
const scale = z.tuple([positive, positive, positive]);
const quaternion = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
]);
const color = z.tuple([
  z.number().min(0).max(1),
  z.number().min(0).max(1),
  z.number().min(0).max(1),
]);

export const mediaPrevisCameraSchema = z
  .object({
    eye: vector.optional(),
    target: vector.optional(),
    up: vector.optional(),
    fov: z.number().min(1).max(179).optional(),
    near: z.number().positive().optional(),
    far: z.number().positive().optional(),
    projection: z.enum(["perspective", "orthographic"]).optional(),
    orthoScale: positive.optional(),
    focalLength: z.number().min(1).max(1_000).optional(),
    sensorWidth: positive.optional(),
    shift: z.tuple([z.number().finite(), z.number().finite()]).optional(),
  })
  .strict();

const geometry = z.discriminatedUnion("type", [
  z
    .object({
      id: identifier,
      type: z.literal("box"),
      bevel: z.number().min(0).max(0.5).optional(),
      subdivisions: z.number().int().min(1).max(16).optional(),
    })
    .strict(),
  z
    .object({
      id: identifier,
      type: z.literal("sphere"),
      segments: z.number().int().min(3).max(64).optional(),
      rings: z.number().int().min(2).max(64).optional(),
    })
    .strict(),
  z
    .object({
      id: identifier,
      type: z.literal("cylinder"),
      segments: z.number().int().min(3).max(64).optional(),
      bevel: z.number().min(0).max(0.5).optional(),
      bevelSegments: z.number().int().min(1).max(8).optional(),
    })
    .strict(),
]);

const material = z
  .object({
    id: identifier,
    tag: z.enum(["surface", "unlit"]).optional(),
    color: color.optional(),
    metallic: z.number().min(0).max(1).optional(),
    roughness: z.number().min(0).max(1).optional(),
    emission: z.number().min(0).max(100).optional(),
    emissiveColor: color.optional(),
    opacity: z.number().min(0).max(1).optional(),
    alphaMode: z.enum(["opaque", "blend", "add"]).optional(),
    doubleSided: z.boolean().optional(),
  })
  .strict();

const node = z
  .object({
    id: identifier,
    label: z.string().max(128).optional(),
    parent: identifier.nullable().optional(),
    geometry: identifier.optional(),
    material: identifier.optional(),
    translation: vector.optional(),
    rotation: quaternion.optional(),
    scale: scale.optional(),
  })
  .strict();

const keyValue = z.union([vector, quaternion, z.number().finite()]);
const motion = z
  .object({
    duration: z.number().min(0.1).max(30),
    loop: z.boolean().optional(),
    tracks: z
      .array(
        z
          .object({
            kind: z.enum(["node", "camera"]),
            id: identifier.optional(),
            property: z.enum([
              "translation",
              "rotation",
              "scale",
              "eye",
              "target",
              "fov",
              "roll",
            ]),
            interpolation: z
              .enum(["LINEAR", "STEP", "SMOOTH", "CUBICSPLINE"])
              .optional(),
            keyframes: z
              .array(
                z
                  .object({
                    time: z.number().min(0).max(30),
                    value: keyValue,
                    inTangent: keyValue.optional(),
                    outTangent: keyValue.optional(),
                  })
                  .strict(),
              )
              .min(1)
              .max(64),
          })
          .strict(),
      )
      .max(64),
  })
  .strict();

export const mediaPrevisRecipeSchema = z
  .object({
    format: z.literal("crucible.scene"),
    schemaVersion: z.literal(1),
    geometries: z.array(geometry).max(32).default([]),
    materials: z.array(material).max(32).default([]),
    nodes: z.array(node).max(64),
    camera: mediaPrevisCameraSchema.optional(),
    environment: z.record(z.string(), jsonValue).optional(),
    effects: z.record(z.string(), jsonValue).optional(),
    shadow: z.record(z.string(), jsonValue).optional(),
    motion: motion.optional(),
  })
  .strict();

export const mediaPrevisViewSchema = z
  .object({
    id: identifier,
    label: z.string().trim().min(1).max(80),
    camera: mediaPrevisCameraSchema,
  })
  .strict();

export const mediaPrevisViewsSchema = z
  .array(mediaPrevisViewSchema)
  .max(8)
  .refine(
    (items) => new Set(items.map((item) => item.id)).size === items.length,
    "视图 ID 不能重复",
  );

export const mediaPrevisOperationSchema = z.discriminatedUnion("type", [
  node
    .partial()
    .required({ id: true })
    .extend({ type: z.literal("set-node") })
    .strict(),
  material
    .pick({
      color: true,
      metallic: true,
      roughness: true,
      emission: true,
      emissiveColor: true,
    })
    .extend({ type: z.literal("set-material"), id: identifier })
    .strict(),
  mediaPrevisCameraSchema.extend({ type: z.literal("set-camera") }).strict(),
  z
    .object({ type: z.literal("set-motion"), motion: motion.nullable() })
    .strict(),
  z.object({ type: z.literal("add-node"), node }).strict(),
  z
    .object({
      type: z.literal("remove-node"),
      id: identifier,
      recursive: z.boolean().optional(),
    })
    .strict(),
  z.object({ type: z.literal("add-geometry"), geometry }).strict(),
  z.object({ type: z.literal("remove-geometry"), id: identifier }).strict(),
  z.object({ type: z.literal("add-material"), material }).strict(),
  z.object({ type: z.literal("remove-material"), id: identifier }).strict(),
]);

export const mediaPrevisIdempotencyKeySchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[\x21-\x7e]+$/);
const idempotency = {
  idempotencyKey: mediaPrevisIdempotencyKeySchema.optional(),
};
const resourceId = z.string().uuid();

export const createMediaPrevisGroupSchema = z
  .object({ name: z.string().trim().min(1).max(80) })
  .strict();
export const updateMediaPrevisGroupSchema = createMediaPrevisGroupSchema
  .extend({
    id: resourceId,
    version: z.number().int().positive(),
  })
  .strict();
export const deleteMediaPrevisGroupSchema = updateMediaPrevisGroupSchema.omit({
  name: true,
});

export const createMediaPrevisSceneSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2_000).default(""),
    groupId: resourceId.nullable().optional(),
    recipe: mediaPrevisRecipeSchema.optional(),
    views: mediaPrevisViewsSchema.default([]),
    ...idempotency,
  })
  .strict();

export const listMediaPrevisScenesSchema = z
  .object({
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(100).default(30),
    search: z.string().trim().max(200).default(""),
    status: z.enum(["active", "archived", "all"]).default("active"),
    groupId: resourceId.nullable().optional(),
  })
  .strict();

export const mediaPrevisSceneIdSchema = z.object({ id: resourceId }).strict();
export const mediaPrevisRevisionIdSchema = z
  .object({ revisionId: resourceId })
  .strict();

export const updateMediaPrevisSceneSchema = z
  .object({
    id: resourceId,
    version: z.number().int().positive(),
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2_000).optional(),
    groupId: resourceId.nullable().optional(),
    thumbnailArtifactId: resourceId.nullable().optional(),
    archived: z.boolean().optional(),
    headRevisionId: resourceId.optional(),
    expectedHeadRevisionId: resourceId.optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (
      input.headRevisionId !== undefined &&
      input.expectedHeadRevisionId === undefined
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["expectedHeadRevisionId"],
        message: "切换版本必须提供预期的当前版本 ID",
      });
    }
    if (
      [
        input.title,
        input.description,
        input.groupId,
        input.thumbnailArtifactId,
        input.archived,
        input.headRevisionId,
      ].every((value) => value === undefined)
    ) {
      ctx.addIssue({ code: "custom", message: "至少提供一个需要修改的字段" });
    }
  });

export const createMediaPrevisRevisionSchema = z
  .object({
    id: resourceId,
    parentRevisionId: resourceId,
    recipe: mediaPrevisRecipeSchema.optional(),
    operations: z.array(mediaPrevisOperationSchema).min(1).max(64).optional(),
    views: mediaPrevisViewsSchema.optional(),
    message: z.string().trim().max(1_000).default(""),
    setCurrent: z.boolean().default(false),
    expectedHeadRevisionId: resourceId.optional(),
    ...idempotency,
  })
  .strict()
  .superRefine((input, ctx) => {
    if ((input.recipe !== undefined) === (input.operations !== undefined)) {
      ctx.addIssue({
        code: "custom",
        path: ["recipe"],
        message: "必须且只能提供 recipe 或 operations 其中之一",
      });
    }
    if (input.setCurrent && input.expectedHeadRevisionId === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["expectedHeadRevisionId"],
        message: "更新当前版本必须提供预期版本 ID",
      });
    }
  });

export const listMediaPrevisRevisionsSchema = z
  .object({
    id: resourceId,
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(100).default(30),
  })
  .strict();

export const forkMediaPrevisSceneSchema = z
  .object({
    id: resourceId,
    revisionId: resourceId,
    title: z.string().trim().min(1).max(200).optional(),
    ...idempotency,
  })
  .strict();

export type MediaPrevisRecipe = z.infer<typeof mediaPrevisRecipeSchema>;
export type MediaPrevisView = z.infer<typeof mediaPrevisViewSchema>;
export type MediaPrevisOperation = z.infer<typeof mediaPrevisOperationSchema>;

export const createMediaPrevisRenderSchema = z
  .object({
    id: resourceId,
    revisionId: resourceId,
    outputType: z.enum(["image", "video"]).default("image"),
    profile: z
      .enum(["preview", "standard", "h3_reference"])
      .default("standard"),
    viewIds: z.array(identifier).max(8).default([]),
    frames: z
      .array(z.number().int().min(1).max(1801))
      .min(1)
      .max(64)
      .default([1]),
    timelineFps: z.number().int().min(1).max(60).default(24),
    width: z.number().int().min(64).max(1920).default(896),
    height: z.number().int().min(64).max(1920).default(512),
    fps: z.number().int().min(1).max(60).default(24),
    startSeconds: z.number().min(0).max(30).default(0),
    durationSeconds: z.number().min(0.1).max(30).default(5),
    ...idempotency,
  })
  .strict()
  .superRefine((input, ctx) => {
    const invalid = (message: string) =>
      ctx.addIssue({ code: "custom", message });
    if (
      new Set(input.viewIds).size !== input.viewIds.length ||
      new Set(input.frames).size !== input.frames.length
    )
      invalid("视图和采样帧不能重复");
    if (
      Math.max(1, input.viewIds.length) *
        (input.outputType === "image" ? input.frames.length : 1) >
      64
    )
      invalid("单批次最多 64 个渲染项");
    if (input.width * input.height > 1920 * 1080)
      invalid("单帧最多 2073600 像素");
    if (
      input.profile === "preview" &&
      (input.width > 896 ||
        input.height > 896 ||
        input.width * input.height > 896 * 512)
    )
      invalid("预览最多 896×512 像素预算");
    if (
      input.outputType === "video" &&
      (input.width % 2 ||
        input.height % 2 ||
        Math.round(input.fps * input.durationSeconds) > 900)
    )
      invalid("视频宽高必须为偶数，最多 900 帧");
    if (
      input.profile === "h3_reference" &&
      (input.outputType !== "video" ||
        input.fps !== 24 ||
        !Number.isInteger(input.durationSeconds) ||
        input.durationSeconds < 5 ||
        input.durationSeconds > 15 ||
        input.width > 1344 ||
        input.height > 1344)
    )
      invalid("H3 参考仅支持 5–15 整数秒、24 FPS 视频，宽高最多 1344");
  });

export const mediaPrevisRenderIdSchema = z
  .object({ renderId: resourceId })
  .strict();
export const listMediaPrevisRendersSchema = listMediaPrevisRevisionsSchema;
export const listMediaPrevisRenderItemsSchema = z
  .object({
    renderId: resourceId,
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(100).default(64),
  })
  .strict();
export const changeMediaPrevisRenderSchema = z
  .object({
    renderId: resourceId,
    itemIds: z.array(resourceId).min(1).max(64).optional(),
  })
  .strict();
export const importMediaPrevisImagesSchema = z
  .object({
    renderId: resourceId,
    artifactIds: z.array(resourceId).min(1).max(64),
  })
  .strict();
export const mediaPrevisArtifactIdSchema = z
  .object({ artifactId: resourceId })
  .strict();
export type MediaPrevisRenderInput = z.infer<
  typeof createMediaPrevisRenderSchema
>;
