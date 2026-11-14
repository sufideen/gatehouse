import { createHash, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { hashPassword, invites, users, writeAudit, type Db } from "@gatehouse/db";
import { passwordProblem } from "./auth";
import { insertConsent, retentionExpiry, type Scope } from "./privacy";

const GUARD_ROLES = ["STATIC_GUARD", "PATROL_DRIVER", "SUBCONTRACTOR"] as const;
export type InviteRole = (typeof GUARD_ROLES)[number];
const sha = (t: string) => createHash("sha256").update(t).digest("hex");

/** Creates a one-time join link token. The invite stores no personal data. The raw token is returned once and never stored. */
export async function createInvite(db: Db, o: { organisationId: string; role: InviteRole; label: string; createdBy: string; ttlDays?: number }) {
  if (!GUARD_ROLES.includes(o.role)) throw new Error("Invalid role for invite");
  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + (o.ttlDays ?? 7) * 86_400_000);
  const [inv] = await db.transaction(async (tx) => {
    const r = await tx.insert(invites).values({ organisationId: o.organisationId, tokenHash: sha(token), role: o.role, label: o.label.slice(0, 80), createdBy: o.createdBy, expiresAt }).returning();
    await writeAudit(tx, { actorId: o.createdBy, action: "PILOT_INVITE_CREATED", entityType: "invite", entityId: r[0]!.id, newValues: { role: o.role, expiresAt } });
    return r;
  });
  return { token, invite: inv! };
}

export async function findOpenInvite(db: Db, token: string, now = new Date()) {
  const [inv] = await db.select().from(invites).where(eq(invites.tokenHash, sha(token)));
  return inv && !inv.usedAt && inv.expiresAt > now ? inv : null;
}

export type JoinInput = {
  token: string; firstName: string; lastName: string; email: string; password: string;
  scopes: Scope[]; policyVersion: string;
  /** Only stored if the matching scope is granted. */
  mobile?: string; siaBadgeNumber?: string; siaLicenceExpiry?: Date | null;
};

/** A real person joins the pilot: their own details, their own password, explicit consent, 30-day retention clock. */
export async function joinWithInvite(db: Db, i: JoinInput) {
  if (process.env.ALLOW_PILOT_DATA !== "true") throw new Error("Real pilot data may only be collected on the dedicated pilot deployment (ALLOW_PILOT_DATA=true)");
  if (!i.scopes.includes("IDENTITY")) throw new Error("Consent to IDENTITY is required to join the pilot");
  const pw = passwordProblem(i.password);
  if (pw) throw new Error(pw);
  const email = i.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Enter a valid email");
  if (!i.firstName.trim() || !i.lastName.trim()) throw new Error("Name is required");
  const passwordHash = await hashPassword(i.password);

  return db.transaction(async (tx) => {
    const [inv] = await tx.select().from(invites).where(eq(invites.tokenHash, sha(i.token))).for("update");
    if (!inv || inv.usedAt || inv.expiresAt <= new Date()) throw new Error("This invite link is invalid, used or expired");
    const [dupe] = await tx.select({ id: users.id }).from(users).where(and(eq(users.organisationId, inv.organisationId), eq(users.email, email)));
    if (dupe) throw new Error("An account with this email already exists");
    const [u] = await tx.insert(users).values({
      organisationId: inv.organisationId, role: inv.role, firstName: i.firstName.trim(), lastName: i.lastName.trim(), email, passwordHash,
      mobile: i.scopes.includes("CONTACT") ? i.mobile?.trim() || null : null,
      siaBadgeNumber: i.scopes.includes("SIA_DETAILS") ? i.siaBadgeNumber?.trim() || null : null,
      siaLicenceExpiry: i.scopes.includes("SIA_DETAILS") ? i.siaLicenceExpiry ?? null : null,
      dataOrigin: "PILOT_CONSENTED", retentionExpiresAt: retentionExpiry(),
    }).returning({ id: users.id });
    await insertConsent(tx as never, { userId: u!.id, scopes: i.scopes, policyVersion: i.policyVersion, recordedBy: u!.id });
    await tx.update(invites).set({ usedAt: new Date(), userId: u!.id }).where(eq(invites.id, inv.id));
    await writeAudit(tx, { actorId: u!.id, action: "PILOT_JOINED", entityType: "user", entityId: u!.id, newValues: { scopes: i.scopes, policyVersion: i.policyVersion, inviteId: inv.id } });
    return { userId: u!.id };
  });
}
