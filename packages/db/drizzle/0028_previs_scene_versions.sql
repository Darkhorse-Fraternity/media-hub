CREATE TABLE "media_previs_request" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"key" text NOT NULL,
	"operation" text NOT NULL,
	"request_hash" text NOT NULL,
	"scene_id" text,
	"revision_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_previs_revision" (
	"id" text PRIMARY KEY NOT NULL,
	"scene_id" text NOT NULL,
	"parent_revision_id" text,
	"revision_number" integer NOT NULL,
	"recipe" jsonb NOT NULL,
	"views" jsonb NOT NULL,
	"checksum" text NOT NULL,
	"engine_version" text NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_previs_scene" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"head_revision_id" text,
	"forked_from_revision_id" text,
	"revision_count" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "media_previs_request" ADD CONSTRAINT "media_previs_request_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_previs_request" ADD CONSTRAINT "media_previs_request_scene_id_media_previs_scene_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."media_previs_scene"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_previs_request" ADD CONSTRAINT "media_previs_request_revision_id_media_previs_revision_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."media_previs_revision"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_previs_revision" ADD CONSTRAINT "media_previs_revision_scene_id_media_previs_scene_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."media_previs_scene"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_previs_revision" ADD CONSTRAINT "media_previs_revision_parent_revision_id_media_previs_revision_id_fk" FOREIGN KEY ("parent_revision_id") REFERENCES "public"."media_previs_revision"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_previs_revision" ADD CONSTRAINT "media_previs_revision_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_previs_scene" ADD CONSTRAINT "media_previs_scene_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_previs_scene" ADD CONSTRAINT "media_previs_scene_head_revision_id_media_previs_revision_id_fk" FOREIGN KEY ("head_revision_id") REFERENCES "public"."media_previs_revision"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_previs_scene" ADD CONSTRAINT "media_previs_scene_forked_from_revision_id_media_previs_revision_id_fk" FOREIGN KEY ("forked_from_revision_id") REFERENCES "public"."media_previs_revision"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "media_previs_request_owner_key_uidx" ON "media_previs_request" USING btree ("owner_user_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "media_previs_revision_scene_number_uidx" ON "media_previs_revision" USING btree ("scene_id","revision_number");--> statement-breakpoint
CREATE INDEX "media_previs_revision_scene_created_idx" ON "media_previs_revision" USING btree ("scene_id","created_at");--> statement-breakpoint
CREATE INDEX "media_previs_scene_owner_updated_idx" ON "media_previs_scene" USING btree ("owner_user_id","updated_at");
