CREATE TABLE "media_video_script" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"brief" text NOT NULL,
	"language" text DEFAULT 'zh' NOT NULL,
	"width" integer DEFAULT 1344 NOT NULL,
	"height" integer DEFAULT 768 NOT NULL,
	"default_profile" text,
	"shots" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "media_generation_job" ADD COLUMN "script_id" text;--> statement-breakpoint
ALTER TABLE "media_generation_job" ADD COLUMN "script_shot_id" text;--> statement-breakpoint
ALTER TABLE "media_video_script" ADD CONSTRAINT "media_video_script_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_video_script_owner_updated_idx" ON "media_video_script" USING btree ("created_by","updated_at");--> statement-breakpoint
ALTER TABLE "media_generation_job" ADD CONSTRAINT "media_generation_job_script_id_media_video_script_id_fk" FOREIGN KEY ("script_id") REFERENCES "public"."media_video_script"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_generation_job_script_shot_idx" ON "media_generation_job" USING btree ("script_id","script_shot_id");