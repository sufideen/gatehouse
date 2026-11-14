import { and, desc, eq, isNull } from "drizzle-orm";
import { consents } from "@gatehouse/db";
import { db } from "@/lib/db";
import { json, mobileUser, unauthorised } from "@/lib/mobile-auth";

export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const u = await mobileUser(req);
  if (!u) return unauthorised();
  const [c] = await db.select().from(consents).where(and(eq(consents.userId, u.id), isNull(consents.withdrawnAt))).orderBy(desc(consents.grantedAt)).limit(1);
  return json({
    user: { id: u.id, firstName: u.firstName, lastName: u.lastName, role: u.role, dataOrigin: u.dataOrigin, retentionExpiresAt: u.retentionExpiresAt, mfaEnabled: !!u.mfaEnabledAt },
    consent: c ? { scopes: c.scopes, policyVersion: c.policyVersion, grantedAt: c.grantedAt } : null,
  });
}
