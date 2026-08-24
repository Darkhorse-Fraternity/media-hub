CREATE TABLE "media_api_token" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text DEFAULT 'Media Hub Agent API' NOT NULL,
	"token_hash" text NOT NULL,
	"token_enc" text NOT NULL,
	"created_by" text NOT NULL,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "media_api_token" ADD CONSTRAINT "media_api_token_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "media_api_token_hash_uidx" ON "media_api_token" USING btree ("token_hash");