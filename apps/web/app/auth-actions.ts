"use server";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { users, verifyPassword, writeAudit } from "@gatehouse/db";
import { requestPasswordReset, resetPassword, verifyMfaLogin } from "@gatehouse/api/account";
import { db } from "@/lib/db";
import {
  baseUrl, clearMfaPending, clientIp, dev, endSession, homeFor, loginLimiter, mfaLimiter, pendingMfaUser, resetLimiter, secret, startMfaPending, startSession,
} from "@/lib/auth";
import type { ActionState } from "@/app/actions";

export async function loginAction(_: ActionState, f: FormData): Promise<ActionState> {
  const email = String(f.get("email") ?? "").trim().toLowerCase();
  const password = String(f.get("password") ?? "");
  const ip = await clientIp();
  if (!loginLimiter.allow(`${email}|${ip}`)) return { ok: false, message: "Too many attempts. Try again in 15 minutes." };

  const matches = await db.select().from(users).where(eq(users.email, email));
  // Same email can exist in several organisations; accept the first whose password verifies.
  let user: (typeof matches)[number] | undefined;
  for (const m of matches) if (!m.anonymisedAt && (await verifyPassword(password, m.passwordHash))) { user = m; break; }
  if (!matches.length) await verifyPassword(password, null); // equalise timing for unknown emails

  if (!user) {
    // Audit only known accounts (by id). Never write unknown, attacker-supplied emails into the permanent log.
    if (matches[0]) await writeAudit(db, { actorId: matches[0].id, action: "LOGIN_FAILED", entityType: "user", entityId: matches[0].id, ipAddress: ip });
    return { ok: false, message: "Incorrect email or password" };
  }
  loginLimiter.reset(`${email}|${ip}`);
  if (user.mfaEnabledAt) {
    // Password alone is NOT a session when MFA is on: hand out a 5-minute "password OK" cookie and ask for the second factor.
    await startMfaPending(user.id);
    redirect("/login/mfa");
  }
  await writeAudit(db, { actorId: user.id, action: "LOGIN_SUCCESS", entityType: "user", entityId: user.id, ipAddress: ip });
  await startSession(user.id);
  redirect(homeFor(user.role)); // staff without MFA are bounced to /security by requireRole
}

export async function mfaLoginAction(_: ActionState, f: FormData): Promise<ActionState> {
  const uid = await pendingMfaUser();
  if (!uid) redirect("/login");
  const ip = await clientIp();
  if (!mfaLimiter.allow(uid)) return { ok: false, message: "Too many attempts. Sign in again in 15 minutes." };
  const result = await verifyMfaLogin(db, { userId: uid, code: String(f.get("code") ?? ""), masterKey: secret(), ipAddress: ip });
  if (result === "BAD_CODE") return { ok: false, message: "That code is not correct" };
  mfaLimiter.reset(uid);
  await clearMfaPending();
  await writeAudit(db, { actorId: uid, action: "LOGIN_SUCCESS", entityType: "user", entityId: uid, ipAddress: ip, newValues: { mfa: result === "RECOVERY_USED" ? "recovery_code" : "totp" } });
  await startSession(uid);
  const [u] = await db.select().from(users).where(eq(users.id, uid));
  redirect(result === "RECOVERY_USED" ? "/security?recovery=1" : homeFor(u!.role));
}

export async function logoutAction() {
  await endSession();
  redirect("/login");
}

const SAME_REPLY = "If that email belongs to an account, a reset link has been sent. It is valid for 1 hour.";

export async function forgotPasswordAction(_: ActionState, f: FormData): Promise<ActionState> {
  const email = String(f.get("email") ?? "").trim().toLowerCase();
  const ip = await clientIp();
  // Rate limited, and the reply is identical whether or not the account exists (no email enumeration).
  if (resetLimiter.allow(`${ip}`) && resetLimiter.allow(email)) {
    await requestPasswordReset(db, { email, baseUrl: baseUrl(), mailer: dev.mailer, ipAddress: ip });
  }
  return { ok: true, message: SAME_REPLY };
}

export async function resetPasswordAction(_: ActionState, f: FormData): Promise<ActionState> {
  const password = String(f.get("password") ?? "");
  if (password !== String(f.get("confirm") ?? "")) return { ok: false, message: "Passwords do not match" };
  if (!resetLimiter.allow(`apply|${await clientIp()}`)) return { ok: false, message: "Too many attempts. Try again later." };
  try {
    await resetPassword(db, { token: String(f.get("token")), newPassword: password, ipAddress: await clientIp() });
  } catch (e) { return { ok: false, message: e instanceof Error ? e.message : "Could not reset password" }; }
  redirect("/login?reset=1");
}
