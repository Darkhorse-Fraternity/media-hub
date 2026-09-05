ALTER TABLE "media_generation_job" ADD COLUMN "error_code" text;--> statement-breakpoint
ALTER TABLE "media_generation_job" ADD COLUMN "failure_stage" text;--> statement-breakpoint
ALTER TABLE "media_generation_job" ADD COLUMN "error_retryable" boolean;
