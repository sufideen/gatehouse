import { desc, eq } from "drizzle-orm";
import { invites } from "@gatehouse/db";
import { ActionForm, btnCls, inputCls } from "@/components/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { createInviteAction } from "@/app/pilot-actions";
import { ADMINS, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { fmt } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Invites() {
  const me = await requireRole(ADMINS);
  const rows = await db.select().from(invites).where(eq(invites.organisationId, me.organisationId)).orderBy(desc(invites.expiresAt)).limit(30);
  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Invite a pilot guard</CardTitle>
        <p className="mb-3 text-sm text-slate-300">No personal data is entered here. The guard opens the one-time link, reads the privacy notice, chooses what to share and sets their own password. Their data is deleted 30 days after they join.</p>
        {process.env.ALLOW_PILOT_DATA !== "true" && <p className="mb-3 rounded bg-amber-900/40 p-2 text-sm text-amber-200">ALLOW_PILOT_DATA is not set on this deployment, so joining is disabled (this is the safe default for the synthetic demo).</p>}
        <ActionForm action={createInviteAction} className="flex flex-wrap items-end gap-2">
          <input name="label" placeholder="Label (e.g. Guard A, not a name)" className={`${inputCls} w-64`} />
          <select name="role" className={inputCls}><option value="STATIC_GUARD">Static guard</option><option value="PATROL_DRIVER">Patrol driver</option></select>
          <button className={btnCls}>Create invite link</button>
        </ActionForm>
      </Card>
      <Card>
        <CardTitle>Invites</CardTitle>
        <ul className="text-sm">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between border-t border-slate-800 py-2">
              <span>{r.label} · {r.role}</span>
              {r.usedAt ? <Badge tone="green">Joined {fmt(r.usedAt)}</Badge> : r.expiresAt < new Date() ? <Badge tone="red">Expired</Badge> : <Badge tone="amber">Open until {fmt(r.expiresAt)}</Badge>}
            </li>
          ))}
          {!rows.length && <li className="text-slate-500">None yet</li>}
        </ul>
      </Card>
    </div>
  );
}
