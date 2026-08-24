CREATE TABLE "media_generation_job" (
	"id" text PRIMARY KEY NOT NULL,
	"prompt" text NOT NULL,
	"title" text,
	"source_image_storage_key" text,
	"source_image_name" text,
	"source_image_content_type" text,
	"duration_seconds" integer DEFAULT 30 NOT NULL,
	"fps" integer DEFAULT 24 NOT NULL,
	"width" integer DEFAULT 960 NOT NULL,
	"height" integer DEFAULT 544 NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"scheduled_at" timestamp,
	"provider_job_id" text,
	"output_storage_key" text,
	"media_task_id" text,
	"error_message" text,
	"created_by" text NOT NULL,
	"started_at" timestamp,
	"finished_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "media_generation_job" ADD CONSTRAINT "media_generation_job_media_task_id_media_task_id_fk" FOREIGN KEY ("media_task_id") REFERENCES "public"."media_task"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "media_generation_job" ADD CONSTRAINT "media_generation_job_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;
