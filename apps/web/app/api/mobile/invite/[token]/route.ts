import { findOpenInvite } from "@gatehouse/api/pilot";
import { db } from "@/lib/db";
import { json } from "@/lib/mobile-auth";

export const dynamic = "force-dynamic";
/** Lets the app check a scanned/tapped invite before showing the join form. Reveals only validity. */
export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return json({ valid: !!(await findOpenInvite(db, token)) && process.env.ALLOW_PILOT_DATA === "true" });
}
