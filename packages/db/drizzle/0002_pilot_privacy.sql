CREATE TYPE "public"."data_origin" AS ENUM('SYNTHETIC', 'PILOT_CONSENTED');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"scopes" jsonb NOT NULL,
	"policy_version" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"recorded_by" uuid
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "data_origin" "data_origin" DEFAULT 'SYNTHETIC' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "retention_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "anonymised_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "consents" ADD CONSTRAINT "consents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "consents_user_idx" ON "consents" USING btree ("user_id");