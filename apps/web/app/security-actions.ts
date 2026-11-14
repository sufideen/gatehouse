"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { users, verifyPassword } from "@gatehouse/db";
import { beginMfaEnrolment, changePassword, confirmMfaEnrolment, issuePasswordReset, resetMfa } from "@gatehouse/api/account";
import { ADMINS, MFA_REQUIRED, actionSession, clientIp, getSession, secret, startSession } from "@/lib/auth";
import { db } from "@/lib/db";
import type { ActionState } from "@/app/actions";

/** Security actions only need a signed-in user (staff must be able to enrol before they pass the MFA gate). */
async function me() {
  const s = await getSession();
  if (!s) throw new Error("Forbidden");
  return s;
}
const fail = (e: unknown): ActionState => ({ ok: false, message: e instanceof Error ? e.message : "Error" });

export async function changePasswordAction(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const u = await me();
    if (String(f.get("next")) !== String(f.get("confirm"))) return { ok: false, message: "New passwords do not match" };
    await changePassword(db, { userId: u.id, current: String(f.get("current") ?? ""), next: String(f.get("next") ?? ""), ipAddress: await clientIp() });
    await startSession(u.id); // every old session was just revoked; keep this browser signed in
    return { ok: true, message: "Password changed. Other devices have been signed out." };
  } catch (e) { return fail(e); }
}

export async function beginMfaAction(): Promise<void> {
  const u = await me();
  await beginMfaEnrolment(db, { userId: u.id, masterKey: secret() });
  revalidatePath("/security");
}

export async function confirmMfaAction(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const u = await me();
    const { recoveryCodes } = await confirmMfaEnrolment(db, { userId: u.id, code: String(f.get("code") ?? ""), masterKey: secret(), ipAddress: await clientIp() });
    // Deliberately no revalidate: the one-time recovery codes must stay on screen until the user has saved them.
    return { ok: true, message: "MFA is on. Save these recovery codes now. Each works once and they will not be shown again:", lines: recoveryCodes };
  } catch (e) { return fail(e); }
}

export async function disableMfaAction(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const u = await me();
    if (MFA_REQUIRED.includes(u.role)) return { ok: false, message: "MFA is mandatory for your role" };
    if (!(await verifyPassword(String(f.get("password") ?? ""), u.passwordHash))) return { ok: false, message: "Password is incorrect" };
    await resetMfa(db, { targetUserId: u.id, actorId: u.id, ipAddress: await clientIp() });
    await startSession(u.id);
  } catch (e) { return fail(e); }
  redirect("/security?mfa=off"); // a banner survives the re-render; an in-form message would not
}

// ---- admin ----
export async function adminIssueResetAction(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const admin = await actionSession(ADMINS);
    const targetId = String(f.get("userId"));
    const [t] = await db.select().from(users).where(eq(users.id, targetId));
    if (!t || t.organisationId !== admin.organisationId) return { ok: false, message: "User not found" }; // tenant check
    const { token } = await issuePasswordReset(db, { targetUserId: t.id, actorId: admin.id, ipAddress: await clientIp() });
    return { ok: true, message: "One-time reset link (valid 1 hour). Give it to the person directly:", lines: [`/reset-password/${token}`] };
  } catch (e) { return fail(e); }
}

export async function adminResetMfaAction(_: ActionState, f: FormData): Promise<ActionState> {
  try {
    const admin = await actionSession(ADMINS);
    const targetId = String(f.get("userId"));
    if (targetId === admin.id) return { ok: false, message: "You cannot reset your own MFA here. Use Security, or ask another admin." };
    const [t] = await db.select().from(users).where(eq(users.id, targetId));
    if (!t || t.organisationId !== admin.organisationId) return { ok: false, message: "User not found" };
    await resetMfa(db, { targetUserId: t.id, actorId: admin.id, ipAddress: await clientIp() });
    revalidatePath("/admin/users");
    return { ok: true, message: "MFA reset. Their sessions were ended; they must enrol again at next sign-in." };
  } catch (e) { return fail(e); }
}
