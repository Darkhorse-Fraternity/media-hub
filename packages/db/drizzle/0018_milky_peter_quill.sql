ALTER TABLE "media_generation_job" ADD COLUMN "gpu_broker_request_id" text;--> statement-breakpoint
ALTER TABLE "media_generation_job" ADD COLUMN "gpu_broker_lease_id" text;--> statement-breakpoint
ALTER TABLE "media_generation_job" ADD COLUMN "asr_transcript" text;--> statement-breakpoint
ALTER TABLE "media_generation_job" ADD COLUMN "asr_match_percent" integer;
