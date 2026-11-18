CREATE TABLE "media_previs_group" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"name" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "media_previs_render" ADD COLUMN "purpose" text DEFAULT 'render' NOT NULL;--> statement-breakpoint
ALTER TABLE "media_previs_scene" ADD COLUMN "group_id" text;--> statement-breakpoint
ALTER TABLE "media_previs_scene" ADD COLUMN "thumbnail_artifact_id" text;--> statement-breakpoint
ALTER TABLE "media_previs_scene" ADD COLUMN "thumbnail_revision_id" text;--> statement-breakpoint
ALTER TABLE "media_previs_scene" ADD COLUMN "thumbnail_mode" text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "media_previs_group" ADD CONSTRAINT "media_previs_group_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "media_previs_group_owner_name_uidx" ON "media_previs_group" USING btree ("owner_user_id","name");--> statement-breakpoint
ALTER TABLE "media_previs_scene" ADD CONSTRAINT "media_previs_scene_group_id_media_previs_group_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."media_previs_group"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_previs_scene" ADD CONSTRAINT "media_previs_scene_thumbnail_artifact_id_media_previs_artifact_id_fk" FOREIGN KEY ("thumbnail_artifact_id") REFERENCES "public"."media_previs_artifact"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_previs_scene" ADD CONSTRAINT "media_previs_scene_thumbnail_revision_id_media_previs_revision_id_fk" FOREIGN KEY ("thumbnail_revision_id") REFERENCES "public"."media_previs_revision"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "media_previs_thumbnail_revision_uidx" ON "media_previs_render" USING btree ("revision_id") WHERE "media_previs_render"."purpose" = 'thumbnail';--> statement-breakpoint
CREATE INDEX "media_previs_scene_owner_group_idx" ON "media_previs_scene" USING btree ("owner_user_id","group_id");
