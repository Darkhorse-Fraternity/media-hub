CREATE TABLE "media_system_setting" (
	"id" text PRIMARY KEY NOT NULL,
	"codex_worker_url" text,
	"codex_worker_source" text,
	"codex_timeout_ms" integer DEFAULT 180000 NOT NULL,
	"ollama_base_url" text,
	"ollama_model" text DEFAULT 'qwen3-vl:32b' NOT NULL,
	"feishu_review_chat_id" text,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_user_preference" (
	"user_id" text PRIMARY KEY NOT NULL,
	"content_language" text DEFAULT 'zh' NOT NULL,
	"duration_seconds" integer DEFAULT 30 NOT NULL,
	"resolution" text DEFAULT '960x544' NOT NULL,
	"youtube_privacy_status" text DEFAULT 'public' NOT NULL,
	"youtube_category_id" text DEFAULT '22' NOT NULL,
	"youtube_notify_subscribers" boolean DEFAULT true NOT NULL,
	"instagram_share_to_feed" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "media_system_setting" ADD CONSTRAINT "media_system_setting_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_user_preference" ADD CONSTRAINT "media_user_preference_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
