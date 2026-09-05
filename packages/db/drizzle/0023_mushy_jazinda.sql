ALTER TABLE "media_generation_job" ADD COLUMN "notification_status" text;--> statement-breakpoint
ALTER TABLE "media_generation_job" ADD COLUMN "notification_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "media_generation_job" ADD COLUMN "notification_error" text;--> statement-breakpoint
ALTER TABLE "media_generation_job" ADD COLUMN "notification_next_attempt_at" timestamp;--> statement-breakpoint
ALTER TABLE "media_generation_job" ADD COLUMN "notification_delivered_at" timestamp;