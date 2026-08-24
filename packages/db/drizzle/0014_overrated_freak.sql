ALTER TABLE "media_image_job" ADD COLUMN "output_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "media_image_job" ADD COLUMN "diversity" integer DEFAULT 50 NOT NULL;