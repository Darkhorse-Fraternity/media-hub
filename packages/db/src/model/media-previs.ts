import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import {
  bigint,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "../auth-schema";
import { mediaImageAsset } from "./media-hub";

export const mediaPrevisGroup = pgTable(
  "media_previs_group",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("media_previs_group_owner_name_uidx").on(
      table.ownerUserId,
      table.name,
    ),
  ],
);

export const mediaPrevisScene = pgTable(
  "media_previs_scene",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    groupId: text("group_id").references(() => mediaPrevisGroup.id, {
      onDelete: "set null",
    }),
    thumbnailArtifactId: text("thumbnail_artifact_id").references(
      (): AnyPgColumn => mediaPrevisArtifact.id,
      { onDelete: "restrict" },
    ),
    thumbnailRevisionId: text("thumbnail_revision_id").references(
      (): AnyPgColumn => mediaPrevisRevision.id,
      { onDelete: "restrict" },
    ),
    thumbnailMode: text("thumbnail_mode")
      .$type<"auto" | "manual">()
      .notNull()
      .default("auto"),
    headRevisionId: text("head_revision_id").references(
      (): AnyPgColumn => mediaPrevisRevision.id,
      { onDelete: "restrict" },
    ),
    forkedFromRevisionId: text("forked_from_revision_id").references(
      (): AnyPgColumn => mediaPrevisRevision.id,
      { onDelete: "restrict" },
    ),
    revisionCount: integer("revision_count").notNull().default(0),
    version: integer("version").notNull().default(1),
    archivedAt: timestamp("archived_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("media_previs_scene_owner_group_idx").on(
      table.ownerUserId,
      table.groupId,
    ),
    index("media_previs_scene_owner_updated_idx").on(
      table.ownerUserId,
      table.updatedAt,
    ),
  ],
);

/** Immutable scene document. Only a scene's selected revision pointer is mutable. */
export const mediaPrevisRevision = pgTable(
  "media_previs_revision",
  {
    id: text("id").primaryKey(),
    sceneId: text("scene_id")
      .notNull()
      .references((): AnyPgColumn => mediaPrevisScene.id, {
        onDelete: "restrict",
      }),
    parentRevisionId: text("parent_revision_id").references(
      (): AnyPgColumn => mediaPrevisRevision.id,
      { onDelete: "restrict" },
    ),
    revisionNumber: integer("revision_number").notNull(),
    recipe: jsonb("recipe").$type<Record<string, unknown>>().notNull(),
    views: jsonb("views")
      .$type<{ id: string; label: string; camera: Record<string, unknown> }[]>()
      .notNull(),
    checksum: text("checksum").notNull(),
    engineVersion: text("engine_version").notNull(),
    schemaVersion: integer("schema_version").notNull().default(1),
    message: text("message").notNull().default(""),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("media_previs_revision_scene_number_uidx").on(
      table.sceneId,
      table.revisionNumber,
    ),
    index("media_previs_revision_scene_created_idx").on(
      table.sceneId,
      table.createdAt,
    ),
  ],
);

/** One owner-wide key per logical mutation; reservation and result commit atomically. */
export const mediaPrevisRequest = pgTable(
  "media_previs_request",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    key: text("key").notNull(),
    operation: text("operation").notNull(),
    requestHash: text("request_hash").notNull(),
    sceneId: text("scene_id").references(() => mediaPrevisScene.id, {
      onDelete: "restrict",
    }),
    revisionId: text("revision_id").references(() => mediaPrevisRevision.id, {
      onDelete: "restrict",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("media_previs_request_owner_key_uidx").on(
      table.ownerUserId,
      table.key,
    ),
  ],
);

export type MediaPrevisItemStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "canceled"
  | "interrupted";
export interface MediaPrevisRenderSpec {
  outputType: "image" | "video";
  profile: "preview" | "standard" | "h3_reference";
  viewId: string | null;
  camera: Record<string, unknown> | null;
  sampleTime: number;
  frame: number | null;
  width: number;
  height: number;
  fps: number;
  frameCount: number;
  nominalDurationSeconds: number;
  durationSeconds: number;
  engineVersion: string;
}

export const mediaPrevisRender = pgTable(
  "media_previs_render",
  {
    id: text("id").primaryKey(),
    sceneId: text("scene_id")
      .notNull()
      .references(() => mediaPrevisScene.id, { onDelete: "restrict" }),
    revisionId: text("revision_id")
      .notNull()
      .references(() => mediaPrevisRevision.id, { onDelete: "restrict" }),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    idempotencyKey: text("idempotency_key"),
    purpose: text("purpose")
      .$type<"render" | "thumbnail">()
      .notNull()
      .default("render"),
    requestHash: text("request_hash").notNull(),
    request: jsonb("request").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("media_previs_thumbnail_revision_uidx")
      .on(table.revisionId)
      .where(sql`${table.purpose} = 'thumbnail'`),
    uniqueIndex("media_previs_render_owner_key_uidx").on(
      table.ownerUserId,
      table.idempotencyKey,
    ),
    index("media_previs_render_scene_created_idx").on(
      table.sceneId,
      table.createdAt,
    ),
  ],
);

export const mediaPrevisRenderItem = pgTable(
  "media_previs_render_item",
  {
    id: text("id").primaryKey(),
    renderId: text("render_id")
      .notNull()
      .references(() => mediaPrevisRender.id, { onDelete: "restrict" }),
    position: integer("position").notNull(),
    spec: jsonb("spec").$type<MediaPrevisRenderSpec>().notNull(),
    status: text("status")
      .$type<MediaPrevisItemStatus>()
      .notNull()
      .default("queued"),
    attemptNumber: integer("attempt_number").notNull().default(0),
    currentAttemptId: text("current_attempt_id"),
    error: text("error"),
    cancelRequestedAt: timestamp("cancel_requested_at"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("media_previs_item_render_position_uidx").on(
      table.renderId,
      table.position,
    ),
    index("media_previs_item_status_idx").on(table.status, table.updatedAt),
  ],
);

export const mediaPrevisRenderAttempt = pgTable(
  "media_previs_render_attempt",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id")
      .notNull()
      .references(() => mediaPrevisRenderItem.id, { onDelete: "restrict" }),
    number: integer("number").notNull(),
    workerId: text("worker_id").notNull(),
    engineJobId: text("engine_job_id"),
    status: text("status").$type<MediaPrevisItemStatus>().notNull(),
    error: text("error"),
    heartbeatAt: timestamp("heartbeat_at").notNull().defaultNow(),
    leaseExpiresAt: timestamp("lease_expires_at").notNull(),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    finishedAt: timestamp("finished_at"),
  },
  (table) => [
    uniqueIndex("media_previs_attempt_item_number_uidx").on(
      table.itemId,
      table.number,
    ),
  ],
);

export const mediaPrevisArtifact = pgTable(
  "media_previs_artifact",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id")
      .notNull()
      .references(() => mediaPrevisRenderItem.id, { onDelete: "restrict" }),
    attemptId: text("attempt_id")
      .notNull()
      .references(() => mediaPrevisRenderAttempt.id, { onDelete: "restrict" }),
    revisionId: text("revision_id")
      .notNull()
      .references(() => mediaPrevisRevision.id, { onDelete: "restrict" }),
    storageKey: text("storage_key").notNull(),
    contentType: text("content_type").notNull(),
    checksum: text("checksum").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    frameCount: integer("frame_count").notNull(),
    fps: integer("fps").notNull(),
    durationSeconds: doublePrecision("duration_seconds").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull(),
    imageAssetId: text("image_asset_id").references(() => mediaImageAsset.id, {
      onDelete: "restrict",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("media_previs_artifact_item_uidx").on(table.itemId),
    uniqueIndex("media_previs_artifact_storage_uidx").on(table.storageKey),
  ],
);
