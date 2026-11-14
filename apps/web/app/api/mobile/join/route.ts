import { z } from "zod";
import { joinWithInvite } from "@gatehouse/api/pilot";
import { SCOPES } from "@gatehouse/api/privacy";
import { resetLimiter } from "@/lib/auth";
import { db } from "@/lib/db";
import { ipOf, issueMobileToken, json } from "@/lib/mobile-auth";
import { POLICY_VERSION } from "@/lib/policy";

export const dynamic = "force-dynamic";
const Body = z.object({
  token: z.string().min(10).max(100), firstName: z.string().max(80), lastName: z.string().max(80), email: z.string().max(200), password: z.string().max(200),
  scopes: z.array(z.enum(SCOPES)), policyVersion: z.string(),
  mobile: z.string().max(30).optional(), siaBadgeNumber: z.string().max(40).optional(), siaLicenceExpiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function POST(req: Request) {
  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) return json({ error: "BAD_REQUEST" }, 400);
  if (!resetLimiter.allow(`join|${ipOf(req)}`)) return json({ error: "RATE_LIMITED" }, 429);
  // Consent must be to the notice version the user actually saw.
  if (b.data.policyVersion !== POLICY_VERSION) return json({ error: "NOTICE_CHANGED", message: "The privacy notice was updated. Please review it again." }, 409);
  try {
    const { userId } = await joinWithInvite(db, { ...b.data, siaLicenceExpiry: b.data.siaLicenceExpiry ? new Date(b.data.siaLicenceExpiry) : null });
    return json({ token: await issueMobileToken(userId) });
  } catch (e) { return json({ error: "JOIN_FAILED", message: e instanceof Error ? e.message : "Could not join" }, 400); }
}
