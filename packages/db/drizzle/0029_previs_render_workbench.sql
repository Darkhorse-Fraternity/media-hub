CREATE TABLE "media_previs_artifact" (
	"id" text PRIMARY KEY NOT NULL,
	"item_id" text NOT NULL,
	"attempt_id" text NOT NULL,
	"revision_id" text NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"checksum" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"frame_count" integer NOT NULL,
	"fps" integer NOT NULL,
	"duration_seconds" double precision NOT NULL,
	"metadata" jsonb NOT NULL,
	"image_asset_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_previs_render" (
	"id" text PRIMARY KEY NOT NULL,
	"scene_id" text NOT NULL,
	"revision_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"idempotency_key" text,
	"request_hash" text NOT NULL,
	"request" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_previs_render_attempt" (
	"id" text PRIMARY KEY NOT NULL,
	"item_id" text NOT NULL,
	"number" integer NOT NULL,
	"worker_id" text NOT NULL,
	"engine_job_id" text,
	"status" text NOT NULL,
	"error" text,
	"heartbeat_at" timestamp DEFAULT now() NOT NULL,
	"lease_expires_at" timestamp NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "media_previs_render_item" (
	"id" text PRIMARY KEY NOT NULL,
	"render_id" text NOT NULL,
	"position" integer NOT NULL,
	"spec" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempt_number" integer DEFAULT 0 NOT NULL,
	"current_attempt_id" text,
	"error" text,
	"cancel_requested_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "media_previs_artifact" ADD CONSTRAINT "media_previs_artifact_item_id_media_previs_render_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."media_previs_render_item"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_previs_artifact" ADD CONSTRAINT "media_previs_artifact_attempt_id_media_previs_render_attempt_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."media_previs_render_attempt"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_previs_artifact" ADD CONSTRAINT "media_previs_artifact_revision_id_media_previs_revision_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."media_previs_revision"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_previs_artifact" ADD CONSTRAINT "media_previs_artifact_image_asset_id_media_image_asset_id_fk" FOREIGN KEY ("image_asset_id") REFERENCES "public"."media_image_asset"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_previs_render" ADD CONSTRAINT "media_previs_render_scene_id_media_previs_scene_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."media_previs_scene"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_previs_render" ADD CONSTRAINT "media_previs_render_revision_id_media_previs_revision_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."media_previs_revision"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_previs_render" ADD CONSTRAINT "media_previs_render_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_previs_render_attempt" ADD CONSTRAINT "media_previs_render_attempt_item_id_media_previs_render_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."media_previs_render_item"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_previs_render_item" ADD CONSTRAINT "media_previs_render_item_render_id_media_previs_render_id_fk" FOREIGN KEY ("render_id") REFERENCES "public"."media_previs_render"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "media_previs_artifact_item_uidx" ON "media_previs_artifact" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "media_previs_artifact_storage_uidx" ON "media_previs_artifact" USING btree ("storage_key");--> statement-breakpoint
CREATE UNIQUE INDEX "media_previs_render_owner_key_uidx" ON "media_previs_render" USING btree ("owner_user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "media_previs_render_scene_created_idx" ON "media_previs_render" USING btree ("scene_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "media_previs_attempt_item_number_uidx" ON "media_previs_render_attempt" USING btree ("item_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "media_previs_item_render_position_uidx" ON "media_previs_render_item" USING btree ("render_id","position");--> statement-breakpoint
CREATE INDEX "media_previs_item_status_idx" ON "media_previs_render_item" USING btree ("status","updated_at");
