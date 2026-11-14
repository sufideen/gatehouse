import { asc, eq, isNull, and } from "drizzle-orm";
import { users } from "@gatehouse/db";
import { ActionForm } from "@/components/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { adminIssueResetAction, adminResetMfaAction } from "@/app/security-actions";
import { ADMINS, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function AdminUsers() {
  const me = await requireRole(ADMINS);
  const rows = await db.select().from(users).where(and(eq(users.organisationId, me.organisationId), isNull(users.anonymisedAt))).orderBy(asc(users.role), asc(users.lastName)).limit(100);
  return (
    <Card>
      <CardTitle>Account recovery</CardTitle>
      <p className="mb-3 text-sm text-slate-400">Issue a one-time password reset link for someone who cannot receive email, or reset a locked-out person&apos;s MFA. Both are audited and end their existing sessions.</p>
      <ul className="text-sm">
        {rows.map((u) => (
          <li key={u.id} className="border-t border-slate-800 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>{u.firstName} {u.lastName} <span className="text-slate-500">· {u.role}</span></span>
              {u.mfaEnabledAt ? <Badge tone="green">MFA on</Badge> : <Badge tone="neutral">MFA off</Badge>}
            </div>
            <div className="mt-1 flex flex-wrap gap-2">
              <ActionForm action={adminIssueResetAction}><input type="hidden" name="userId" value={u.id} /><button className="rounded bg-slate-700 px-2 py-1 text-xs hover:bg-slate-600">Issue reset link</button></ActionForm>
              {u.mfaEnabledAt && u.id !== me.id && <ActionForm action={adminResetMfaAction}><input type="hidden" name="userId" value={u.id} /><button className="rounded bg-amber-700 px-2 py-1 text-xs hover:bg-amber-600">Reset MFA</button></ActionForm>}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
