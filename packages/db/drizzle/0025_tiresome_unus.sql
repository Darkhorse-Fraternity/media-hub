ALTER TABLE "media_generation_job" ADD COLUMN "dialogues" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "media_generation_job" ADD COLUMN "audio_validation_status" text;--> statement-breakpoint
ALTER TABLE "media_generation_job" ADD COLUMN "audio_validation_error" text;