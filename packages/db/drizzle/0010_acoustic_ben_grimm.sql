ALTER TABLE "media_generation_job" ADD COLUMN "kind" text DEFAULT 'generate' NOT NULL;--> statement-breakpoint
ALTER TABLE "media_generation_job" ADD COLUMN "source_generation_job_id" text;--> statement-breakpoint
ALTER TABLE "media_generation_job" ADD COLUMN "edit_segments" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "media_generation_job" ADD COLUMN "provider_job_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "media_generation_job" ADD COLUMN "preserve_source_audio" boolean DEFAULT true NOT NULL;