ALTER TABLE "media_generation_job" ALTER COLUMN "width" SET DEFAULT 1344;--> statement-breakpoint
ALTER TABLE "media_generation_job" ALTER COLUMN "height" SET DEFAULT 768;--> statement-breakpoint
ALTER TABLE "media_user_preference" ALTER COLUMN "resolution" SET DEFAULT '1344x768';--> statement-breakpoint
UPDATE "media_user_preference" SET "resolution" = '1344x768' WHERE "resolution" = '960x544';--> statement-breakpoint
ALTER TABLE "media_generation_job" ADD COLUMN "quality_preset" text DEFAULT 'balanced' NOT NULL;--> statement-breakpoint
ALTER TABLE "media_generation_job" ADD COLUMN "steps" integer DEFAULT 6 NOT NULL;--> statement-breakpoint
ALTER TABLE "media_generation_job" ADD COLUMN "seed" bigint;--> statement-breakpoint
ALTER TABLE "media_generation_job" ADD COLUMN "profile" text DEFAULT 'platform-h3-i2v-inline-v1' NOT NULL;--> statement-breakpoint
ALTER TABLE "media_generation_job" ADD COLUMN "workflow_version" text;--> statement-breakpoint
ALTER TABLE "media_generation_job" ADD COLUMN "model_version" text;
