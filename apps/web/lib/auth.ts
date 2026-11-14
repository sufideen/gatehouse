import { isIP } from "node:net";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { users } from "@gatehouse/db";
import { mailerFromEnv, type MailerChoice } from "@gatehouse/api/mail";
import { createRateLimiter, signSession, verifySession } from "@gatehouse/api/auth";
import { db } from "./db";

export type Role = typeof users.$inferSelect["role"];
export type SessionUser = typeof users.$inferSelect;

export const COOKIE = "gh_session";
const TTL_MS = 8 * 3_600_000;

export const STAFF: Role[] = ["ADMIN", "COMPLIANCE_ADMIN", "CONTROL_ROOM"];
export const ADMINS: Role[] = ["ADMIN", "COMPLIANCE_ADMIN"];
export const GUARDS: Role[] = ["STATIC_GUARD", "PATROL_DRIVER", "SUBCONTRACTOR"];

export function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (s && s.length >= 32) return s;
  if (process.env.NODE_ENV === "production") throw new Error("AUTH_SECRET (32+ chars) is required in production");
  return "dev-only-secret-do-not-use-in-production-0000";
}

const g = globalThis as unknown as {
  __loginLimiter?: ReturnType<typeof createRateLimiter>; __mfaLimiter?: ReturnType<typeof createRateLimiter>;
  __resetLimiter?: ReturnType<typeof createRateLimiter>; __mail?: MailerChoice;
};
export const loginLimiter = (g.__loginLimiter ??= createRateLimiter(5, 15 * 60_000));
export const mfaLimiter = (g.__mfaLimiter ??= createRateLimiter(5, 15 * 60_000));
export const resetLimiter = (g.__resetLimiter ??= createRateLimiter(5, 15 * 60_000));
/** SMTP when SMTP_URL + MAIL_FROM are set; dev mailer (outbox page) otherwise; throws in production without SMTP. Lazy on purpose. */
export const getMailer = (): MailerChoice => (g.__mail ??= mailerFromEnv());

/** Reset links must never be built from the request Host header (link poisoning), so the base URL is configuration. */
export function baseUrl(): string {
  const u = process.env.APP_BASE_URL;
  if (u) return u.replace(/\/$/, "");
  if (process.env.NODE_ENV === "production") throw new Error("APP_BASE_URL is required in production");
  return `http://localhost:${process.env.PORT ?? 3100}`;
}

/** Roles that handle other people's data must use MFA. Guards and client viewers may opt in. */
export const MFA_REQUIRED: Role[] = ["ADMIN", "COMPLIANCE_ADMIN", "CONTROL_ROOM"];
export const mfaSetupRequired = (u: SessionUser) => MFA_REQUIRED.includes(u.role) && !u.mfaEnabledAt;

// Pending second-factor cookie: proves the password step only. Signed with a different key so it can never be used as a session.
export const MFA_COOKIE = "gh_mfa";
export async function startMfaPending(userId: string) {
  (await cookies()).set(MFA_COOKIE, signSession({ uid: userId, exp: Date.now() + 5 * 60_000 }, secret() + ":mfa"), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 300 });
}
export async function pendingMfaUser(): Promise<string | null> {
  return verifySession((await cookies()).get(MFA_COOKIE)?.value, secret() + ":mfa")?.uid ?? null;
}
export async function clearMfaPending() { (await cookies()).delete(MFA_COOKIE); }

export async function startSession(userId: string) {
  const [u] = await db.select({ ep: users.sessionEpoch }).from(users).where(eq(users.id, userId));
  const token = signSession({ uid: userId, exp: Date.now() + TTL_MS, ep: u?.ep ?? 0 }, secret());
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: TTL_MS / 1000 });
}
export async function endSession() { (await cookies()).delete(COOKIE); }

/** Re-reads the user on every request: deleted/anonymised/credential-less accounts lose access immediately. */
export async function getSession(): Promise<SessionUser | null> {
  const p = verifySession((await cookies()).get(COOKIE)?.value, secret());
  if (!p) return null;
  const [u] = await db.select().from(users).where(eq(users.id, p.uid));
  // A password/MFA reset bumps sessionEpoch, which instantly invalidates every older session cookie.
  return u && !u.anonymisedAt && u.passwordHash && (p.ep ?? 0) === u.sessionEpoch ? u : null;
}

/** For pages: redirects to login or the forbidden page. */
export async function requireRole(roles: Role[]): Promise<SessionUser> {
  const s = await getSession();
  if (!s) redirect("/login");
  if (mfaSetupRequired(s)) redirect("/security"); // staff cannot do anything until MFA is enrolled
  if (!roles.includes(s.role)) redirect("/forbidden");
  return s;
}

/** Signed-in only (no MFA gate): used by the security page itself so staff can complete enrolment. */
export async function requireUser(): Promise<SessionUser> {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}

/** For server actions (public POST endpoints): throws instead of redirecting. Always call first. */
export async function actionSession(roles: Role[]): Promise<SessionUser> {
  const s = await getSession();
  if (!s || !roles.includes(s.role) || mfaSetupRequired(s)) throw new Error("Forbidden");
  return s;
}

export const homeFor = (r: Role) => (GUARDS.includes(r) ? "/guard" : r === "CLIENT_VIEWER" ? "/client-portal" : "/dashboard");

export async function clientIp(): Promise<string | null> {
  const h = await headers();
  const ip = (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "").trim();
  return isIP(ip) ? ip : null;
}
