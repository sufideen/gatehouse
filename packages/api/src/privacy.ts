import { and, eq, inArray, isNull, lte } from "drizzle-orm";
import {
  attendanceLogs, consents, immutableAuditLogs, incidentReports, patrolLogs, shifts, users, welfareChecks, writeAudit, type Db,
} from "@gatehouse/db";

/** Pilot data retention: auto-anonymised 30 days after consent. */
export const PILOT_RETENTION_DAYS = 30;
export const SCOPES = ["IDENTITY", "CONTACT", "SIA_DETAILS"] as const;
export type Scope = (typeof SCOPES)[number];
const DAY = 86_400_000;

/** Reserved/non-routable domains (RFC 2606/6761): the only emails allowed in SYNTHETIC data. */
export const isReservedEmail = (email: string) => /@([a-z0-9-]+\.)*(example|invalid|test|localhost)$|@example\.(com|org|net)$/i.test(email);

export const retentionExpiry = (from = new Date()) => new Date(from.getTime() + PILOT_RETENTION_DAYS * DAY);

type Tx = Pick<Db, "insert" | "update" | "select">;

/** Records consent and starts the 30-day retention clock. IDENTITY is mandatory. */
export async function recordConsent(db: Db, o: { userId: string; scopes: Scope[]; policyVersion: string; recordedBy: string | null; ipAddress?: string | null }) {
  if (!o.scopes.includes("IDENTITY")) throw new Error("IDENTITY scope is required for any pilot participation");
  return db.transaction(async (tx) => {
    const c = await insertConsent(tx as unknown as Tx, o);
    await writeAudit(tx, { actorId: o.recordedBy, ipAddress: o.ipAddress, action: "CONSENT_GRANTED", entityType: "user", entityId: o.userId, newValues: { scopes: o.scopes, policyVersion: o.policyVersion } });
    return c;
  });
}

/** Shared by recordConsent and the importer. */
export async function insertConsent(tx: Tx, o: { userId: string; scopes: Scope[]; policyVersion: string; recordedBy: string | null }) {
  const [c] = await tx.insert(consents).values({ userId: o.userId, scopes: o.scopes, policyVersion: o.policyVersion, recordedBy: o.recordedBy }).returning();
  await tx.update(users).set({ dataOrigin: "PILOT_CONSENTED", retentionExpiresAt: retentionExpiry() }).where(eq(users.id, o.userId));
  return c!;
}

/** Withdrawing IDENTITY (or everything) anonymises the person; narrower withdrawals null just those fields. */
export async function withdrawConsent(db: Db, o: { userId: string; scopes: Scope[]; actorId: string | null; ipAddress?: string | null }) {
  const active = await db.select().from(consents).where(and(eq(consents.userId, o.userId), isNull(consents.withdrawnAt)));
  const held = new Set(active.flatMap((c) => c.scopes as Scope[]));
  const remaining = [...held].filter((s) => !o.scopes.includes(s));
  if (!remaining.includes("IDENTITY")) return anonymiseUser(db, { userId: o.userId, actorId: o.actorId, reason: "CONSENT_WITHDRAWN", ipAddress: o.ipAddress });
  await db.transaction(async (tx) => {
    const patch: Partial<typeof users.$inferInsert> = {};
    if (o.scopes.includes("CONTACT")) patch.mobile = null;
    if (o.scopes.includes("SIA_DETAILS")) { patch.siaBadgeNumber = null; patch.siaLicenceExpiry = null; patch.siaSector = null; }
    if (Object.keys(patch).length) await tx.update(users).set(patch).where(eq(users.id, o.userId));
    await tx.update(consents).set({ withdrawnAt: new Date() }).where(and(eq(consents.userId, o.userId), isNull(consents.withdrawnAt)));
    await tx.insert(consents).values({ userId: o.userId, scopes: remaining, policyVersion: active[0]?.policyVersion ?? "unknown", recordedBy: o.actorId });
    await writeAudit(tx, { actorId: o.actorId, ipAddress: o.ipAddress, action: "CONSENT_PARTIALLY_WITHDRAWN", entityType: "user", entityId: o.userId, newValues: { withdrawn: o.scopes, remaining } });
  });
  return { anonymised: false, s3KeysToDelete: [] as string[] };
}

/**
 * Right-to-erasure / retention. The users row is kept (so audit and patrol logs stay valid, append-only
 * and contain only IDs) but every personal field is removed. Returns S3 keys the caller must delete.
 */
export async function anonymiseUser(db: Db, o: { userId: string; actorId: string | null; reason: string; ipAddress?: string | null }) {
  return db.transaction(async (tx) => {
    const [u] = await tx.select().from(users).where(eq(users.id, o.userId)).for("update");
    if (!u) throw new Error("User not found");
    if (u.anonymisedAt) return { anonymised: false, s3KeysToDelete: [] as string[] };

    const myShifts = (await tx.select({ id: shifts.id }).from(shifts).where(eq(shifts.guardId, o.userId))).map((s) => s.id);
    const keys: string[] = [];
    if (myShifts.length) {
      const att = await tx.select().from(attendanceLogs).where(inArray(attendanceLogs.shiftId, myShifts));
      keys.push(...att.map((a) => a.clockInSelfieS3Key).filter((k) => k !== "ERASED"));
      await tx.update(attendanceLogs).set({ clockInSelfieS3Key: "ERASED" }).where(inArray(attendanceLogs.shiftId, myShifts));
      const wc = await tx.select().from(welfareChecks).where(inArray(welfareChecks.shiftId, myShifts));
      keys.push(...wc.flatMap((w) => (w.audioRecordingS3Key ? [w.audioRecordingS3Key] : [])));
      await tx.update(welfareChecks).set({ audioRecordingS3Key: null }).where(inArray(welfareChecks.shiftId, myShifts));
    }
    const inc = await tx.select().from(incidentReports).where(eq(incidentReports.guardId, o.userId));
    keys.push(...inc.flatMap((i) => i.mediaKeysJson));
    await tx.update(incidentReports).set({ transcriptText: null, mediaKeysJson: [] }).where(eq(incidentReports.guardId, o.userId));

    await tx.update(users).set({
      firstName: "Anonymised", lastName: "User", email: `anon-${o.userId}@anonymised.invalid`, mobile: null,
      siaBadgeNumber: null, siaLicenceExpiry: null, siaSector: null, emergencyContactName: null, emergencyContactPhone: null,
      passwordHash: null, // account can no longer log in
      mfaSecretEnc: null, mfaEnabledAt: null, mfaLastStep: null, mfaRecoveryHashes: [],
      anonymisedAt: new Date(),
    }).where(eq(users.id, o.userId));
    await tx.update(consents).set({ withdrawnAt: new Date() }).where(and(eq(consents.userId, o.userId), isNull(consents.withdrawnAt)));
    // IDs and counts only: the audit log itself must not hold personal data.
    await writeAudit(tx, { actorId: o.actorId, ipAddress: o.ipAddress, action: "USER_ANONYMISED", entityType: "user", entityId: o.userId, newValues: { reason: o.reason, mediaObjects: keys.length } });
    return { anonymised: true, s3KeysToDelete: keys };
  });
}

/** Run daily (cron). Anonymises every consented pilot user whose 30 days are up. */
export async function runRetention(db: Db, now = new Date()) {
  const due = await db.select({ id: users.id }).from(users).where(and(
    eq(users.dataOrigin, "PILOT_CONSENTED"), isNull(users.anonymisedAt), lte(users.retentionExpiresAt, now)));
  const s3KeysToDelete: string[] = [];
  for (const { id } of due) s3KeysToDelete.push(...(await anonymiseUser(db, { userId: id, actorId: null, reason: `RETENTION_${PILOT_RETENTION_DAYS}D` })).s3KeysToDelete);
  return { anonymisedUserIds: due.map((d) => d.id), s3KeysToDelete };
}

/** Subject access request: everything held about one person (UK GDPR art. 15 / 20). */
export async function exportSubjectData(db: Db, userId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) throw new Error("User not found");
  const myShifts = await db.select().from(shifts).where(eq(shifts.guardId, userId));
  const ids = myShifts.map((s) => s.id);
  const [att, patrols, welfare, incidents, consentRows, audit] = await Promise.all([
    ids.length ? db.select().from(attendanceLogs).where(inArray(attendanceLogs.shiftId, ids)) : [],
    ids.length ? db.select().from(patrolLogs).where(inArray(patrolLogs.shiftId, ids)) : [],
    ids.length ? db.select().from(welfareChecks).where(inArray(welfareChecks.shiftId, ids)) : [],
    db.select().from(incidentReports).where(eq(incidentReports.guardId, userId)),
    db.select().from(consents).where(eq(consents.userId, userId)),
    db.select().from(immutableAuditLogs).where(eq(immutableAuditLogs.actorId, userId)),
  ]);
  const { passwordHash: _p, mfaSecretEnc: _m, mfaRecoveryHashes: _r, ...safeUser } = user; // never export credentials
  return { exportedAt: new Date().toISOString(), user: safeUser, consents: consentRows, shifts: myShifts, attendance: att, patrolScans: patrols, welfareChecks: welfare, incidents, auditEntriesByUser: audit };
}
