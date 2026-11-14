import { applySyncBatch, syncBatch } from "@gatehouse/api/sync";
import { db } from "@/lib/db";
import { ipOf, json, mobileUser, unauthorised } from "@/lib/mobile-auth";

export const dynamic = "force-dynamic";
/** Authenticated offline-queue sync. The guard id comes from the token; a body-supplied id is ignored. */
export async function POST(req: Request) {
  const u = await mobileUser(req);
  if (!u) return unauthorised();
  const raw = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const b = syncBatch.safeParse({ ...raw, guardId: u.id });
  if (!b.success) return json({ error: "VALIDATION", issues: b.error.issues }, 400);
  return json({ results: await applySyncBatch(db, b.data, ipOf(req)) });
}
