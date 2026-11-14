import { isIP } from "node:net";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { users } from "@gatehouse/db";
import { createRateLimiter, signSession, verifySession } from "@gatehouse/api/auth";
import { db } from "./db";

export type Role = typeof users.$inferSelect["role"];
export type SessionUser = typeof users.$inferSelect;

export const COOKIE = "gh_session";
const TTL_MS = 8 * 3_600_000;

export const STAFF: Role[] = ["ADMIN", "COMPLIANCE_ADMIN", "CONTROL_ROOM"];
export const ADMINS: Role[] = ["ADMIN", "COMPLIANCE_ADMIN"];
export const GUARDS: Role[] = ["STATIC_GUARD", "PATROL_DRIVER", "SUBCONTRACTOR"];

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (s && s.length >= 32) return s;
  if (process.env.NODE_ENV === "production") throw new Error("AUTH_SECRET (32+ chars) is required in production");
  return "dev-only-secret-do-not-use-in-production-0000";
}

const g = globalThis as unknown as { __loginLimiter?: ReturnType<typeof createRateLimiter> };
export const loginLimiter = (g.__loginLimiter ??= createRateLimiter(5, 15 * 60_000));

export async function startSession(userId: string) {
  const token = signSession({ uid: userId, exp: Date.now() + TTL_MS }, secret());
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: TTL_MS / 1000 });
}
export async function endSession() { (await cookies()).delete(COOKIE); }

/** Re-reads the user on every request: deleted/anonymised/credential-less accounts lose access immediately. */
export async function getSession(): Promise<SessionUser | null> {
  const p = verifySession((await cookies()).get(COOKIE)?.value, secret());
  if (!p) return null;
  const [u] = await db.select().from(users).where(eq(users.id, p.uid));
  return u && !u.anonymisedAt && u.passwordHash ? u : null;
}

/** For pages: redirects to login or the forbidden page. */
export async function requireRole(roles: Role[]): Promise<SessionUser> {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!roles.includes(s.role)) redirect("/forbidden");
  return s;
}

/** For server actions (public POST endpoints): throws instead of redirecting. Always call first. */
export async function actionSession(roles: Role[]): Promise<SessionUser> {
  const s = await getSession();
  if (!s || !roles.includes(s.role)) throw new Error("Forbidden");
  return s;
}

export const homeFor = (r: Role) => (GUARDS.includes(r) ? "/guard" : r === "CLIENT_VIEWER" ? "/client-portal" : "/dashboard");

export async function clientIp(): Promise<string | null> {
  const h = await headers();
  const ip = (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "").trim();
  return isIP(ip) ? ip : null;
}
