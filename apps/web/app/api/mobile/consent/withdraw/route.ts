import { z } from "zod";
import { SCOPES, withdrawConsent } from "@gatehouse/api/privacy";
import { db } from "@/lib/db";
import { ipOf, json, mobileUser, unauthorised } from "@/lib/mobile-auth";

export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  const u = await mobileUser(req);
  if (!u) return unauthorised();
  const b = z.object({ scopes: z.array(z.enum(SCOPES)).min(1) }).safeParse(await req.json().catch(() => null));
  if (!b.success) return json({ error: "BAD_REQUEST" }, 400);
  const r = await withdrawConsent(db, { userId: u.id, scopes: b.data.scopes, actorId: u.id, ipAddress: ipOf(req) });
  return json({ anonymised: r.anonymised });
}
