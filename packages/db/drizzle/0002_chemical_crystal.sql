CREATE TABLE "media_platform_stats" (
	"id" text PRIMARY KEY NOT NULL,
	"platform" text NOT NULL,
	"account_id" text NOT NULL,
	"external_video_id" text NOT NULL,
	"video_title" text,
	"view_count" bigint DEFAULT 0 NOT NULL,
	"like_count" bigint DEFAULT 0 NOT NULL,
	"comment_count" bigint DEFAULT 0 NOT NULL,
	"snapshot_date" text NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "media_platform_stats" ADD CONSTRAINT "media_platform_stats_account_id_media_platform_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."media_platform_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mps_video_date_uidx" ON "media_platform_stats" USING btree ("external_video_id","snapshot_date");