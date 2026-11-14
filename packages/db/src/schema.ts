import { sql } from "drizzle-orm";
import {
  boolean, date, index, inet, integer, jsonb, numeric, pgEnum, pgTable,
  text, timestamp, unique, uuid, varchar,
} from "drizzle-orm/pg-core";
import { geographyPoint, geographyPolygon } from "./geo";

export const userRole = pgEnum("user_role", [
  "ADMIN", "COMPLIANCE_ADMIN", "CONTROL_ROOM", "PATROL_DRIVER", "STATIC_GUARD", "SUBCONTRACTOR", "CLIENT_VIEWER",
]);
export const vettingStatus = pgEnum("bs7858_vetting_status", ["PENDING", "IN_PROGRESS", "VERIFIED", "FAILED"]);
export const employmentType = pgEnum("employment_type", ["FULL_TIME", "RELIEF_BANK"]);
export const shiftType = pgEnum("shift_type", ["STATIC", "MOBILE_PATROL"]);
export const shiftStatus = pgEnum("shift_status", ["OPEN", "ASSIGNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]);
export const welfareStatus = pgEnum("welfare_status", ["PENDING", "OK", "OVERDUE", "SOS_TRIGGERED"]);
export const incidentSeverity = pgEnum("incident_severity", ["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const organisations = pgTable("organisations", {
  id: id(),
  name: text("name").notNull(),
  companyNumber: varchar("company_number", { length: 8 }),
  acsReference: text("acs_reference"),
  isSecurityProvider: boolean("is_security_provider").notNull().default(false),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: id(),
  organisationId: uuid("organisation_id").notNull().references(() => organisations.id),
  role: userRole("role").notNull(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email").notNull(),
  mobile: text("mobile"),
  employmentType: employmentType("employment_type"),
  siaBadgeNumber: varchar("sia_badge_number", { length: 32 }),
  siaSector: text("sia_sector"),
  siaLicenceExpiry: date("sia_licence_expiry", { mode: "date" }),
  bs7858VettingStatus: vettingStatus("bs7858_vetting_status").notNull().default("PENDING"),
  emergencyContactName: text("emergency_contact_name"),
  emergencyContactPhone: text("emergency_contact_phone"),
  /** Client viewers are scoped to a client organisation's sites. */
  clientOrganisationId: uuid("client_organisation_id").references(() => organisations.id),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [
  unique("users_org_email_uq").on(t.organisationId, t.email),
  index("users_org_role_idx").on(t.organisationId, t.role),
]);

export const sites = pgTable("sites", {
  id: id(),
  organisationId: uuid("organisation_id").notNull().references(() => organisations.id),
  clientId: uuid("client_id").references(() => organisations.id),
  name: text("name").notNull(),
  address: text("address").notNull(),
  postcode: varchar("postcode", { length: 10 }).notNull(),
  geofence: geographyPolygon("geofence"),
  centre: geographyPoint("centre"),
  radiusMeters: integer("radius_meters").notNull().default(75),
  siteInstructions: text("site_instructions"),
}, (t) => [index("sites_org_idx").on(t.organisationId)]);

export const siteInductions = pgTable("site_inductions", {
  id: id(),
  siteId: uuid("site_id").notNull().references(() => sites.id),
  guardId: uuid("guard_id").notNull().references(() => users.id),
  completedAt: ts("completed_at").notNull(),
}, (t) => [unique("site_inductions_uq").on(t.siteId, t.guardId)]);

export const checkpoints = pgTable("checkpoints", {
  id: id(),
  siteId: uuid("site_id").notNull().references(() => sites.id),
  name: text("name").notNull(),
  /** Arbitrary external string: preserves incumbent Guardhouse QR/NFC tags. */
  externalTagUid: text("external_tag_uid").notNull(),
  expectedIntervalMins: integer("expected_interval_mins"),
  location: geographyPoint("location"),
}, (t) => [unique("checkpoints_site_tag_uq").on(t.siteId, t.externalTagUid)]);

export const shifts = pgTable("shifts", {
  id: id(),
  siteId: uuid("site_id").notNull().references(() => sites.id),
  guardId: uuid("guard_id").references(() => users.id),
  shiftType: shiftType("shift_type").notNull(),
  startUtc: ts("start_utc").notNull(),
  endUtc: ts("end_utc").notNull(),
  payRateGbp: numeric("pay_rate_gbp", { precision: 8, scale: 2 }).notNull(),
  chargeRateGbp: numeric("charge_rate_gbp", { precision: 8, scale: 2 }).notNull(),
  status: shiftStatus("status").notNull().default("OPEN"),
}, (t) => [index("shifts_site_start_idx").on(t.siteId, t.startUtc), index("shifts_guard_idx").on(t.guardId)]);

export const attendanceLogs = pgTable("attendance_logs", {
  id: id(),
  shiftId: uuid("shift_id").notNull().references(() => shifts.id),
  /** Client-generated UUIDv7 for idempotent sync. */
  syncUuid: uuid("sync_uuid").notNull().unique(),
  clockInUtc: ts("clock_in_utc").notNull(),
  clockInGps: geographyPoint("clock_in_gps").notNull(),
  /** Anti-buddy-punching: selfie is mandatory for static clock-in. */
  clockInSelfieS3Key: text("clock_in_selfie_s3_key").notNull(),
  clockOutUtc: ts("clock_out_utc"),
  clockOutGps: geographyPoint("clock_out_gps"),
  isOfflineSynced: boolean("is_offline_synced").notNull().default(false),
});

export const patrolLogs = pgTable("patrol_logs", {
  id: id(),
  shiftId: uuid("shift_id").notNull().references(() => shifts.id),
  checkpointId: uuid("checkpoint_id").references(() => checkpoints.id),
  scannedTagUid: text("scanned_tag_uid").notNull(),
  scannedUtc: ts("scanned_utc").notNull(),
  gpsPoint: geographyPoint("gps_point"),
  syncUuid: uuid("sync_uuid").notNull().unique(),
}, (t) => [index("patrol_logs_shift_idx").on(t.shiftId, t.scannedUtc)]);

export const welfareChecks = pgTable("welfare_checks", {
  id: id(),
  shiftId: uuid("shift_id").notNull().references(() => shifts.id),
  syncUuid: uuid("sync_uuid").unique(),
  dueUtc: ts("due_utc").notNull(),
  confirmedUtc: ts("confirmed_utc"),
  status: welfareStatus("status").notNull().default("PENDING"),
  audioRecordingS3Key: text("audio_recording_s3_key"),
});

export const incidentReports = pgTable("incident_reports", {
  id: id(),
  siteId: uuid("site_id").notNull().references(() => sites.id),
  guardId: uuid("guard_id").notNull().references(() => users.id),
  syncUuid: uuid("sync_uuid").unique(),
  severity: incidentSeverity("severity").notNull(),
  category: text("category").notNull(),
  transcriptText: text("transcript_text"),
  mediaKeysJson: jsonb("media_keys_json").$type<string[]>().notNull().default([]),
  clientVisible: boolean("client_visible").notNull().default(false),
  reportedUtc: ts("reported_utc").notNull().defaultNow(),
});

export const immutableAuditLogs = pgTable("immutable_audit_logs", {
  id: id(),
  actorId: uuid("actor_id"),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  oldValuesJson: jsonb("old_values_json"),
  newValuesJson: jsonb("new_values_json"),
  ipAddress: inet("ip_address"),
  utcTimestamp: ts("utc_timestamp").notNull().defaultNow(),
}, (t) => [index("audit_entity_idx").on(t.entityType, t.entityId), index("audit_ts_idx").on(t.utcTimestamp)]);

