import { z } from "zod";
import { verifyMfaLogin } from "@gatehouse/api/account";
import { writeAudit } from "@gatehouse/db";
import { GUARDS, mfaLimiter, secret } from "@/lib/auth";
import { checkPassword } from "@/lib/credentials";
import { db } from "@/lib/db";
import { ipOf, issueMobileToken, json } from "@/lib/mobile-auth";

export const dynamic = "force-dynamic";
const Body = z.object({ email: z.string().max(200), password: z.string().max(200), code: z.string().max(20).optional() });

export async function POST(req: Request) {
  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) return json({ error: "BAD_REQUEST" }, 400);
  const ip = ipOf(req);
  const r = await checkPassword(b.data.email, b.data.password, ip);
  if ("error" in r) return json({ error: r.error }, r.error === "RATE_LIMITED" ? 429 : 401);
  const u = r.user;
  if (!GUARDS.includes(u.role)) return json({ error: "BAD_CREDENTIALS" }, 401); // staff use the web app; same reply, no role leak
  let mfa = "none";
  if (u.mfaEnabledAt) {
    if (!b.data.code) return json({ error: "MFA_REQUIRED" }, 401);
    if (!mfaLimiter.allow(u.id)) return json({ error: "RATE_LIMITED" }, 429);
    const res = await verifyMfaLogin(db, { userId: u.id, code: b.data.code, masterKey: secret(), ipAddress: ip });
    if (res === "BAD_CODE") return json({ error: "BAD_CODE" }, 401);
    mfaLimiter.reset(u.id);
    mfa = res === "RECOVERY_USED" ? "recovery_code" : "totp";
  }
  await writeAudit(db, { actorId: u.id, action: "LOGIN_SUCCESS", entityType: "user", entityId: u.id, ipAddress: ip, newValues: { client: "mobile", mfa } });
  return json({ token: await issueMobileToken(u.id) });
}
