import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { attendanceLogs, checkpoints, incidentReports, patrolLogs, pointWkt, shifts, welfareChecks, writeAudit, type Db } from "@gatehouse/db";
import { isWithinSiteGeofence } from "./geofence";

const uuidV7 = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, "must be UUIDv7");
const gps = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
const base = { syncUuid: uuidV7, deviceUtc: z.coerce.date() };

export const syncRecord = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("CLOCK_IN"), shiftId: z.string().uuid(), gps, selfieKey: z.string().min(1) }),
  z.object({ ...base, type: z.literal("CLOCK_OUT"), attendanceSyncUuid: uuidV7, gps }),
  z.object({ ...base, type: z.literal("PATROL_SCAN"), shiftId: z.string().uuid(), tagUid: z.string().min(1), gps: gps.optional() }),
  z.object({ ...base, type: z.literal("WELFARE_CHECK"), shiftId: z.string().uuid(), dueUtc: z.coerce.date(), status: z.enum(["OK", "OVERDUE", "SOS_TRIGGERED"]), audioKey: z.string().optional() }),
  z.object({ ...base, type: z.literal("INCIDENT"), siteId: z.string().uuid(), severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]), category: z.string().min(1), transcript: z.string().optional(), mediaKeys: z.array(z.string()).default([]) }),
]);
export const syncBatch = z.object({ deviceId: z.string().min(1), guardId: z.string().uuid(), records: z.array(syncRecord).min(1).max(500) });
export type SyncBatch = z.infer<typeof syncBatch>;
export type SyncResult = { syncUuid: string; status: "APPLIED" | "DUPLICATE" | "REJECTED"; reason?: string };

/** Idempotent batch apply. Each record is its own transaction so one bad record can't poison a batch. */
export async function applySyncBatch(db: Db, batch: SyncBatch, ipAddress: string | null = null): Promise<SyncResult[]> {
  const out: SyncResult[] = [];
  for (const r of batch.records) {
    try {
      out.push(await db.transaction((tx) => applyOne(tx as unknown as Db, batch.guardId, r, ipAddress)));
    } catch (e) {
      out.push({ syncUuid: r.syncUuid, status: "REJECTED", reason: e instanceof Error ? e.message : "error" });
    }
  }
  return out;
}

async function applyOne(tx: Db, guardId: string, r: z.infer<typeof syncRecord>, ip: string | null): Promise<SyncResult> {
  const dup = { syncUuid: r.syncUuid, status: "DUPLICATE" as const };
  const ok = { syncUuid: r.syncUuid, status: "APPLIED" as const };
  const audit = (action: string, entityType: string, entityId: string, newValues: unknown) =>
    writeAudit(tx, { actorId: guardId, action, entityType, entityId, newValues, ipAddress: ip });

  switch (r.type) {
    case "CLOCK_IN": {
      const [shift] = await tx.select().from(shifts).where(eq(shifts.id, r.shiftId));
      if (!shift || shift.guardId !== guardId) throw new Error("Shift not assigned to this guard");
      // Anti-buddy-punching: geofence (server-authoritative) AND selfie key are both mandatory.
      if (!(await isWithinSiteGeofence(tx, shift.siteId, r.gps.lat, r.gps.lng))) throw new Error("Outside site geofence");
      const rows = await tx.insert(attendanceLogs).values({
        shiftId: r.shiftId, syncUuid: r.syncUuid, clockInUtc: r.deviceUtc, clockInGps: pointWkt(r.gps.lat, r.gps.lng),
        clockInSelfieS3Key: r.selfieKey, isOfflineSynced: true,
      }).onConflictDoNothing().returning({ id: attendanceLogs.id });
      if (!rows.length) return dup;
      await tx.update(shifts).set({ status: "IN_PROGRESS" }).where(eq(shifts.id, r.shiftId));
      await audit("CLOCK_IN", "attendance_log", rows[0]!.id, { shiftId: r.shiftId, deviceUtc: r.deviceUtc, selfieKey: r.selfieKey, gps: r.gps });
      return ok;
    }
    case "CLOCK_OUT": {
      const [att] = await tx.select().from(attendanceLogs).where(eq(attendanceLogs.syncUuid, r.attendanceSyncUuid));
      if (!att) throw new Error("Unknown clock-in");
      if (att.clockOutUtc) return dup;
      await tx.update(attendanceLogs).set({ clockOutUtc: r.deviceUtc, clockOutGps: pointWkt(r.gps.lat, r.gps.lng) }).where(eq(attendanceLogs.id, att.id));
      await audit("CLOCK_OUT", "attendance_log", att.id, { deviceUtc: r.deviceUtc, gps: r.gps });
      return ok;
    }
    case "PATROL_SCAN": {
      const [shift] = await tx.select().from(shifts).where(eq(shifts.id, r.shiftId));
      if (!shift || shift.guardId !== guardId) throw new Error("Shift not assigned to this guard");
      // Tag UIDs are arbitrary external strings (legacy Guardhouse tags).
      const [cp] = await tx.select().from(checkpoints).where(and(eq(checkpoints.siteId, shift.siteId), eq(checkpoints.externalTagUid, r.tagUid)));
      const rows = await tx.insert(patrolLogs).values({
        shiftId: r.shiftId, checkpointId: cp?.id ?? null, scannedTagUid: r.tagUid, scannedUtc: r.deviceUtc,
        gpsPoint: r.gps ? pointWkt(r.gps.lat, r.gps.lng) : null, syncUuid: r.syncUuid,
      }).onConflictDoNothing().returning({ id: patrolLogs.id });
      if (!rows.length) return dup;
      await audit("PATROL_SCAN", "patrol_log", rows[0]!.id, { tagUid: r.tagUid, matchedCheckpoint: cp?.id ?? null });
      return ok;
    }
    case "WELFARE_CHECK": {
      const rows = await tx.insert(welfareChecks).values({
        shiftId: r.shiftId, syncUuid: r.syncUuid, dueUtc: r.dueUtc, confirmedUtc: r.status === "OK" ? r.deviceUtc : null,
        status: r.status, audioRecordingS3Key: r.audioKey,
      }).onConflictDoNothing().returning({ id: welfareChecks.id });
      if (!rows.length) return dup;
      await audit("WELFARE_CHECK", "welfare_check", rows[0]!.id, { status: r.status });
      return ok;
    }
    case "INCIDENT": {
      const rows = await tx.insert(incidentReports).values({
        siteId: r.siteId, guardId, syncUuid: r.syncUuid, severity: r.severity, category: r.category,
        transcriptText: r.transcript, mediaKeysJson: r.mediaKeys, reportedUtc: r.deviceUtc,
      }).onConflictDoNothing().returning({ id: incidentReports.id });
      if (!rows.length) return dup;
      await audit("INCIDENT_REPORTED", "incident_report", rows[0]!.id, { severity: r.severity, category: r.category });
      return ok;
    }
  }
}
