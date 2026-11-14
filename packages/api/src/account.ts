import { randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { hashPassword, passwordResets, users, verifyPassword, writeAudit, type Db } from "@gatehouse/db";
import {
  decryptSecret, encryptSecret, generateRecoveryCodes, generateTotpSecret, hashRecoveryCode, otpauthUri, passwordProblem, sha256, verifyTotp,
} from "./auth";

// ---------------------------------------------------------------- mail

export type Mailer = { send(to: string, subject: string, text: string): Promise<void> };

/** Dev mailer: keeps the last messages in memory (shown at /dev/outbox in non-production) and logs them. No SMTP yet. */
export function createDevMailer() {
  const outbox: { to: string; subject: string; text: string; at: Date }[] = [];
  const mailer: Mailer = {
    async send(to, subject, text) {
      outbox.unshift({ to, subject, text, at: new Date() });
      outbox.length = Math.min(outbox.length, 20);
      console.log(`[dev-mail] to=${to} subject=${subject}\n${text}`);
    },
  };
  return { mailer, outbox };
}

// ---------------------------------------------------------------- password reset

export const RESET_TTL_MS = 60 * 60_000; // 1 hour

async function createResetToken(db: Db, userId: string, createdBy: string | null) {
  const token = randomBytes(32).toString("base64url");
  await db.insert(passwordResets).values({ userId, tokenHash: sha256(token), expiresAt: new Date(Date.now() + RESET_TTL_MS), createdBy });
  return token;
}

/**
 * Self-service "forgot password". Never reveals whether the email exists: the caller shows the same message either way.
 * Only audited for real accounts (by id), so attacker-supplied emails never reach the permanent log.
 */
export async function requestPasswordReset(db: Db, o: { email: string; baseUrl: string; mailer: Mailer; ipAddress?: string | null }) {
  const matches = await db.select().from(users).where(eq(users.email, o.email.trim().toLowerCase()));
  for (const u of matches) {
    if (u.anonymisedAt || !u.passwordHash) continue;
    const token = await createResetToken(db, u.id, null);
    await writeAudit(db, { actorId: u.id, action: "PASSWORD_RESET_REQUESTED", entityType: "user", entityId: u.id, ipAddress: o.ipAddress });
    await o.mailer.send(u.email, "Reset your Gatehouse password",
      `Use this link within 1 hour to choose a new password:\n${o.baseUrl}/reset-password/${token}\n\nIf you did not ask for this, ignore this email.`);
  }
}

/** Admin-issued link for someone who cannot receive email (pilot guards). Shown once to the admin. */
export async function issuePasswordReset(db: Db, o: { targetUserId: string; actorId: string; ipAddress?: string | null }) {
  const [t] = await db.select().from(users).where(eq(users.id, o.targetUserId));
  if (!t || t.anonymisedAt) throw new Error("User not found");
  const token = await createResetToken(db, t.id, o.actorId);
  await writeAudit(db, { actorId: o.actorId, action: "PASSWORD_RESET_ISSUED_BY_ADMIN", entityType: "user", entityId: t.id, ipAddress: o.ipAddress });
  return { token };
}

export async function findOpenReset(db: Db, token: string, now = new Date()) {
  const [r] = await db.select().from(passwordResets).where(eq(passwordResets.tokenHash, sha256(token)));
  return r && !r.usedAt && r.expiresAt > now ? r : null;
}

/** Sets a new password, kills every other open reset link, and revokes all existing sessions. MFA is NOT bypassed. */
export async function resetPassword(db: Db, o: { token: string; newPassword: string; ipAddress?: string | null }) {
  const problem = passwordProblem(o.newPassword);
  if (problem) throw new Error(problem);
  const hash = await hashPassword(o.newPassword);
  return db.transaction(async (tx) => {
    const [r] = await tx.select().from(passwordResets).where(eq(passwordResets.tokenHash, sha256(o.token))).for("update");
    if (!r || r.usedAt || r.expiresAt <= new Date()) throw new Error("This reset link is invalid, used or expired");
    const [u] = await tx.select().from(users).where(eq(users.id, r.userId));
    if (!u || u.anonymisedAt) throw new Error("This reset link is invalid, used or expired");
    await tx.update(users).set({ passwordHash: hash, sessionEpoch: sql`${users.sessionEpoch} + 1` }).where(eq(users.id, u.id));
    await tx.update(passwordResets).set({ usedAt: new Date() }).where(and(eq(passwordResets.userId, u.id), isNull(passwordResets.usedAt)));
    await writeAudit(tx, { actorId: u.id, action: "PASSWORD_RESET", entityType: "user", entityId: u.id, ipAddress: o.ipAddress, newValues: { viaAdmin: r.createdBy !== null } });
    return { userId: u.id };
  });
}

/** Signed-in password change. Requires the current password; revokes all sessions (the caller must start a fresh one). */
export async function changePassword(db: Db, o: { userId: string; current: string; next: string; ipAddress?: string | null }) {
  const problem = passwordProblem(o.next);
  if (problem) throw new Error(problem);
  const [u] = await db.select().from(users).where(eq(users.id, o.userId));
  if (!u || !(await verifyPassword(o.current, u.passwordHash))) throw new Error("Current password is incorrect");
  const hash = await hashPassword(o.next);
  const [upd] = await db.transaction(async (tx) => {
    const r = await tx.update(users).set({ passwordHash: hash, sessionEpoch: sql`${users.sessionEpoch} + 1` }).where(eq(users.id, u.id)).returning({ epoch: users.sessionEpoch });
    await writeAudit(tx, { actorId: u.id, action: "PASSWORD_CHANGED", entityType: "user", entityId: u.id, ipAddress: o.ipAddress });
    return r;
  });
  return { epoch: upd!.epoch };
}

// ---------------------------------------------------------------- MFA (TOTP)

/** Starts enrolment: stores a fresh, not-yet-active secret. Safe to call again until confirmed. */
export async function beginMfaEnrolment(db: Db, o: { userId: string; masterKey: string }) {
  const [u] = await db.select().from(users).where(eq(users.id, o.userId));
  if (!u) throw new Error("User not found");
  if (u.mfaEnabledAt) throw new Error("MFA is already enabled");
  const secret = generateTotpSecret();
  await db.update(users).set({ mfaSecretEnc: encryptSecret(secret, o.masterKey) }).where(eq(users.id, u.id));
  return { secret, uri: otpauthUri(u.email, secret) };
}

/** Shows the in-progress (unconfirmed) secret again so the QR code is stable across page loads. */
export async function getPendingMfa(db: Db, o: { userId: string; masterKey: string }) {
  const [u] = await db.select().from(users).where(eq(users.id, o.userId));
  if (!u?.mfaSecretEnc || u.mfaEnabledAt) return null;
  const secret = decryptSecret(u.mfaSecretEnc, o.masterKey);
  return { secret, uri: otpauthUri(u.email, secret) };
}

/** Confirms the first code, activates MFA, and returns 10 one-time recovery codes (shown once, stored hashed). */
export async function confirmMfaEnrolment(db: Db, o: { userId: string; code: string; masterKey: string; ipAddress?: string | null }) {
  const [u] = await db.select().from(users).where(eq(users.id, o.userId));
  if (!u?.mfaSecretEnc || u.mfaEnabledAt) throw new Error("No enrolment in progress");
  const step = verifyTotp(decryptSecret(u.mfaSecretEnc, o.masterKey), o.code.trim());
  if (step === null) throw new Error("That code is not correct. Check your authenticator and try again.");
  const codes = generateRecoveryCodes();
  await db.transaction(async (tx) => {
    await tx.update(users).set({ mfaEnabledAt: new Date(), mfaLastStep: step, mfaRecoveryHashes: codes.map(hashRecoveryCode) }).where(eq(users.id, u.id));
    await writeAudit(tx, { actorId: u.id, action: "MFA_ENABLED", entityType: "user", entityId: u.id, ipAddress: o.ipAddress });
  });
  return { recoveryCodes: codes };
}

export type MfaResult = "OK" | "RECOVERY_USED" | "BAD_CODE";

/** Second login factor: a TOTP code (replay-protected) or a one-time recovery code. */
export async function verifyMfaLogin(db: Db, o: { userId: string; code: string; masterKey: string; ipAddress?: string | null }): Promise<MfaResult> {
  return db.transaction(async (tx) => {
    const [u] = await tx.select().from(users).where(eq(users.id, o.userId)).for("update");
    if (!u?.mfaEnabledAt || !u.mfaSecretEnc) return "BAD_CODE";
    const code = o.code.trim();
    if (/^\d{6}$/.test(code)) {
      const step = verifyTotp(decryptSecret(u.mfaSecretEnc, o.masterKey), code, { lastStep: u.mfaLastStep });
      if (step !== null) { await tx.update(users).set({ mfaLastStep: step }).where(eq(users.id, u.id)); return "OK"; }
    } else {
      const h = hashRecoveryCode(code);
      if (u.mfaRecoveryHashes.includes(h)) {
        await tx.update(users).set({ mfaRecoveryHashes: u.mfaRecoveryHashes.filter((x) => x !== h) }).where(eq(users.id, u.id));
        await writeAudit(tx, { actorId: u.id, action: "MFA_RECOVERY_CODE_USED", entityType: "user", entityId: u.id, ipAddress: o.ipAddress, newValues: { remaining: u.mfaRecoveryHashes.length - 1 } });
        return "RECOVERY_USED";
      }
    }
    await writeAudit(tx, { actorId: u.id, action: "MFA_FAILED", entityType: "user", entityId: u.id, ipAddress: o.ipAddress });
    return "BAD_CODE";
  });
}

/**
 * Removes MFA and revokes sessions. Used by an admin for a locked-out person (never on yourself), or by a person
 * disabling their own optional MFA. Staff roles must re-enrol at next sign-in.
 */
export async function resetMfa(db: Db, o: { targetUserId: string; actorId: string; ipAddress?: string | null }) {
  await db.transaction(async (tx) => {
    const [t] = await tx.select().from(users).where(eq(users.id, o.targetUserId));
    if (!t) throw new Error("User not found");
    await tx.update(users).set({ mfaSecretEnc: null, mfaEnabledAt: null, mfaLastStep: null, mfaRecoveryHashes: [], sessionEpoch: sql`${users.sessionEpoch} + 1` }).where(eq(users.id, t.id));
    await writeAudit(tx, { actorId: o.actorId, action: o.actorId === t.id ? "MFA_DISABLED" : "MFA_RESET_BY_ADMIN", entityType: "user", entityId: t.id, ipAddress: o.ipAddress });
  });
}

