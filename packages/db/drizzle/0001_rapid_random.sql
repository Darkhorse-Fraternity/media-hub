CREATE TABLE "media_platform_account" (
	"id" text PRIMARY KEY NOT NULL,
	"platform" text NOT NULL,
	"account_label" text NOT NULL,
	"external_account_id" text NOT NULL,
	"access_token_enc" text NOT NULL,
	"refresh_token_enc" text,
	"token_expires_at" timestamp,
	"scopes" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_publish_target" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"platform" text NOT NULL,
	"account_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"external_post_id" text,
	"external_url" text,
	"published_at" timestamp,
	"error_message" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_review_log" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"reviewer" text NOT NULL,
	"action" text NOT NULL,
	"comment" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_task" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"hashtags" text,
	"language" text DEFAULT 'en' NOT NULL,
	"video_storage_key" text NOT NULL,
	"cover_storage_key" text,
	"ai_prompts" jsonb,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" text NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "media_platform_account" ADD CONSTRAINT "media_platform_account_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_publish_target" ADD CONSTRAINT "media_publish_target_task_id_media_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."media_task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_publish_target" ADD CONSTRAINT "media_publish_target_account_id_media_platform_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."media_platform_account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_review_log" ADD CONSTRAINT "media_review_log_task_id_media_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."media_task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_review_log" ADD CONSTRAINT "media_review_log_reviewer_user_id_fk" FOREIGN KEY ("reviewer") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_task" ADD CONSTRAINT "media_task_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_task" ADD CONSTRAINT "media_task_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;