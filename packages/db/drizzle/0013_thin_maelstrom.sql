CREATE TABLE "media_image_asset" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text,
	"storage_key" text NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"width" integer,
	"height" integer,
	"size_bytes" bigint NOT NULL,
	"checksum" text NOT NULL,
	"origin" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "media_image_job" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text DEFAULT 'generate' NOT NULL,
	"title" text,
	"prompt" text NOT NULL,
	"negative_prompt" text DEFAULT '' NOT NULL,
	"width" integer DEFAULT 1024 NOT NULL,
	"height" integer DEFAULT 1024 NOT NULL,
	"seed" bigint,
	"profile" text DEFAULT 'platform-hidream-o1-image-v1' NOT NULL,
	"workflow_version" text,
	"model_version" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"provider_job_id" text,
	"error_message" text,
	"created_by" text NOT NULL,
	"started_at" timestamp,
	"finished_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_image_job_input" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"asset_id" text NOT NULL,
	"position" integer NOT NULL,
	"role" text DEFAULT 'reference' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "media_generation_job" ADD COLUMN "input_image_asset_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "media_image_asset" ADD CONSTRAINT "media_image_asset_job_id_media_image_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."media_image_job"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_image_asset" ADD CONSTRAINT "media_image_asset_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_image_job" ADD CONSTRAINT "media_image_job_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_image_job_input" ADD CONSTRAINT "media_image_job_input_job_id_media_image_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."media_image_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_image_job_input" ADD CONSTRAINT "media_image_job_input_asset_id_media_image_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."media_image_asset"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_image_asset_owner_created_idx" ON "media_image_asset" USING btree ("owner_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "media_image_asset_storage_key_uidx" ON "media_image_asset" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "media_image_job_owner_created_idx" ON "media_image_job" USING btree ("created_by","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "media_image_job_input_position_uidx" ON "media_image_job_input" USING btree ("job_id","position");