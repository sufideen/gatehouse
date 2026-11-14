import { anonymiseUser } from "@gatehouse/api/privacy";
import { db } from "@/lib/db";
import { ipOf, json, mobileUser, unauthorised } from "@/lib/mobile-auth";

export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  const u = await mobileUser(req);
  if (!u) return unauthorised();
  await anonymiseUser(db, { userId: u.id, actorId: u.id, reason: "ERASURE_REQUEST", ipAddress: ipOf(req) });
  return json({ ok: true });
}
