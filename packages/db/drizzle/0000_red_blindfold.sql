CREATE EXTENSION IF NOT EXISTS postgis;--> statement-breakpoint
CREATE TYPE "public"."employment_type" AS ENUM('FULL_TIME', 'RELIEF_BANK');--> statement-breakpoint
CREATE TYPE "public"."incident_severity" AS ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');--> statement-breakpoint
CREATE TYPE "public"."shift_status" AS ENUM('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."shift_type" AS ENUM('STATIC', 'MOBILE_PATROL');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('ADMIN', 'COMPLIANCE_ADMIN', 'CONTROL_ROOM', 'PATROL_DRIVER', 'STATIC_GUARD', 'SUBCONTRACTOR', 'CLIENT_VIEWER');--> statement-breakpoint
CREATE TYPE "public"."bs7858_vetting_status" AS ENUM('PENDING', 'IN_PROGRESS', 'VERIFIED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."welfare_status" AS ENUM('PENDING', 'OK', 'OVERDUE', 'SOS_TRIGGERED');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "attendance_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shift_id" uuid NOT NULL,
	"sync_uuid" uuid NOT NULL,
	"clock_in_utc" timestamp with time zone NOT NULL,
	"clock_in_gps" geography(Point, 4326) NOT NULL,
	"clock_in_selfie_s3_key" text NOT NULL,
	"clock_out_utc" timestamp with time zone,
	"clock_out_gps" geography(Point, 4326),
	"is_offline_synced" boolean DEFAULT false NOT NULL,
	CONSTRAINT "attendance_logs_sync_uuid_unique" UNIQUE("sync_uuid")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"name" text NOT NULL,
	"external_tag_uid" text NOT NULL,
	"expected_interval_mins" integer,
	"location" geography(Point, 4326),
	CONSTRAINT "checkpoints_site_tag_uq" UNIQUE("site_id","external_tag_uid")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "immutable_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"old_values_json" jsonb,
	"new_values_json" jsonb,
	"ip_address" "inet",
	"utc_timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "incident_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"guard_id" uuid NOT NULL,
	"sync_uuid" uuid,
	"severity" "incident_severity" NOT NULL,
	"category" text NOT NULL,
	"transcript_text" text,
	"media_keys_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"client_visible" boolean DEFAULT false NOT NULL,
	"reported_utc" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "incident_reports_sync_uuid_unique" UNIQUE("sync_uuid")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organisations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"company_number" varchar(8),
	"acs_reference" text,
	"is_security_provider" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "patrol_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shift_id" uuid NOT NULL,
	"checkpoint_id" uuid,
	"scanned_tag_uid" text NOT NULL,
	"scanned_utc" timestamp with time zone NOT NULL,
	"gps_point" geography(Point, 4326),
	"sync_uuid" uuid NOT NULL,
	CONSTRAINT "patrol_logs_sync_uuid_unique" UNIQUE("sync_uuid")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"guard_id" uuid,
	"shift_type" "shift_type" NOT NULL,
	"start_utc" timestamp with time zone NOT NULL,
	"end_utc" timestamp with time zone NOT NULL,
	"pay_rate_gbp" numeric(8, 2) NOT NULL,
	"charge_rate_gbp" numeric(8, 2) NOT NULL,
	"status" "shift_status" DEFAULT 'OPEN' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "site_inductions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"guard_id" uuid NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "site_inductions_uq" UNIQUE("site_id","guard_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"client_id" uuid,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"postcode" varchar(10) NOT NULL,
	"geofence" geography(Polygon, 4326),
	"centre" geography(Point, 4326),
	"radius_meters" integer DEFAULT 75 NOT NULL,
	"site_instructions" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"role" "user_role" NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text NOT NULL,
	"mobile" text,
	"employment_type" "employment_type",
	"sia_badge_number" varchar(32),
	"sia_sector" text,
	"sia_licence_expiry" date,
	"bs7858_vetting_status" "bs7858_vetting_status" DEFAULT 'PENDING' NOT NULL,
	"emergency_contact_name" text,
	"emergency_contact_phone" text,
	"client_organisation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_org_email_uq" UNIQUE("organisation_id","email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "welfare_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shift_id" uuid NOT NULL,
	"sync_uuid" uuid,
	"due_utc" timestamp with time zone NOT NULL,
	"confirmed_utc" timestamp with time zone,
	"status" "welfare_status" DEFAULT 'PENDING' NOT NULL,
	"audio_recording_s3_key" text,
	CONSTRAINT "welfare_checks_sync_uuid_unique" UNIQUE("sync_uuid")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "attendance_logs" ADD CONSTRAINT "attendance_logs_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "checkpoints" ADD CONSTRAINT "checkpoints_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "incident_reports" ADD CONSTRAINT "incident_reports_guard_id_users_id_fk" FOREIGN KEY ("guard_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "patrol_logs" ADD CONSTRAINT "patrol_logs_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "patrol_logs" ADD CONSTRAINT "patrol_logs_checkpoint_id_checkpoints_id_fk" FOREIGN KEY ("checkpoint_id") REFERENCES "public"."checkpoints"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shifts" ADD CONSTRAINT "shifts_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "shifts" ADD CONSTRAINT "shifts_guard_id_users_id_fk" FOREIGN KEY ("guard_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "site_inductions" ADD CONSTRAINT "site_inductions_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "site_inductions" ADD CONSTRAINT "site_inductions_guard_id_users_id_fk" FOREIGN KEY ("guard_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sites" ADD CONSTRAINT "sites_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sites" ADD CONSTRAINT "sites_client_id_organisations_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "users" ADD CONSTRAINT "users_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "users" ADD CONSTRAINT "users_client_organisation_id_organisations_id_fk" FOREIGN KEY ("client_organisation_id") REFERENCES "public"."organisations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "welfare_checks" ADD CONSTRAINT "welfare_checks_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_entity_idx" ON "immutable_audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_ts_idx" ON "immutable_audit_logs" USING btree ("utc_timestamp");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "patrol_logs_shift_idx" ON "patrol_logs" USING btree ("shift_id","scanned_utc");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shifts_site_start_idx" ON "shifts" USING btree ("site_id","start_utc");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shifts_guard_idx" ON "shifts" USING btree ("guard_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sites_org_idx" ON "sites" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_org_role_idx" ON "users" USING btree ("organisation_id","role");