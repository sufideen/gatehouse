"use server";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { users, verifyPassword, writeAudit } from "@gatehouse/db";
import { db } from "@/lib/db";
import { clientIp, endSession, homeFor, loginLimiter, startSession } from "@/lib/auth";
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
  await writeAudit(db, { actorId: user.id, action: "LOGIN_SUCCESS", entityType: "user", entityId: user.id, ipAddress: ip });
  await startSession(user.id);
  redirect(homeFor(user.role));
}

export async function logoutAction() {
  await endSession();
  redirect("/login");
}
