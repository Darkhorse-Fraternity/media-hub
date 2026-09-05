ALTER TABLE "media_image_job" ADD COLUMN "script_id" text;--> statement-breakpoint
ALTER TABLE "media_image_job" ADD COLUMN "script_shot_id" text;--> statement-breakpoint
ALTER TABLE "media_image_job" ADD COLUMN "purpose" text DEFAULT 'general' NOT NULL;--> statement-breakpoint
ALTER TABLE "media_video_script" ADD COLUMN "copy" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "media_video_script" ADD COLUMN "copy_status" text DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "media_image_job" ADD CONSTRAINT "media_image_job_script_id_media_video_script_id_fk" FOREIGN KEY ("script_id") REFERENCES "public"."media_video_script"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_image_job_script_shot_idx" ON "media_image_job" USING btree ("script_id","script_shot_id");