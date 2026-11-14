import { eq } from "drizzle-orm";
import { users, verifyPassword, writeAudit } from "@gatehouse/db";
import { db } from "./db";
import { loginLimiter, type SessionUser } from "./auth";

export type PasswordCheck = { user: SessionUser } | { error: "RATE_LIMITED" | "BAD_CREDENTIALS" };

/** Shared by web and mobile login: rate limit, constant-ish timing, audit only known accounts (by id). */
export async function checkPassword(email: string, password: string, ip: string | null): Promise<PasswordCheck> {
  email = email.trim().toLowerCase();
  if (!loginLimiter.allow(`${email}|${ip}`)) return { error: "RATE_LIMITED" };
  const matches = await db.select().from(users).where(eq(users.email, email));
  let user: SessionUser | undefined;
  for (const m of matches) if (!m.anonymisedAt && (await verifyPassword(password, m.passwordHash))) { user = m; break; }
  if (!matches.length) await verifyPassword(password, null);
  if (!user) {
    if (matches[0]) await writeAudit(db, { actorId: matches[0].id, action: "LOGIN_FAILED", entityType: "user", entityId: matches[0].id, ipAddress: ip });
    return { error: "BAD_CREDENTIALS" };
  }
  loginLimiter.reset(`${email}|${ip}`);
  return { user };
}
