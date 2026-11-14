import { eq } from "drizzle-orm";
import { users } from "@gatehouse/db";
import { signSession, verifySession } from "@gatehouse/api/auth";
import { GUARDS, secret, type SessionUser } from "./auth";
import { db } from "./db";

// Mobile uses a bearer token (no cookies => no CSRF), signed with its own derived key so it can never be used as a web session.
const key = () => secret() + ":mobile";
const TTL_MS = 14 * 86_400_000;

export async function issueMobileToken(userId: string): Promise<string> {
  const [u] = await db.select({ ep: users.sessionEpoch }).from(users).where(eq(users.id, userId));
  return signSession({ uid: userId, exp: Date.now() + TTL_MS, ep: u?.ep ?? 0 }, key());
}

/** Valid token + guard role + not anonymised + epoch still current (password/MFA reset revokes it). */
export async function mobileUser(req: Request): Promise<SessionUser | null> {
  const m = /^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "");
  const p = verifySession(m?.[1], key());
  if (!p) return null;
  const [u] = await db.select().from(users).where(eq(users.id, p.uid));
  return u && !u.anonymisedAt && u.passwordHash && GUARDS.includes(u.role) && (p.ep ?? 0) === u.sessionEpoch ? u : null;
}

export const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });
export const unauthorised = () => json({ error: "UNAUTHORISED" }, 401);
export const ipOf = (req: Request) => {
  const ip = (req.headers.get("x-forwarded-for")?.split(",")[0] ?? "").trim();
  return /^[0-9a-fA-F:.]+$/.test(ip) ? ip : null;
};
