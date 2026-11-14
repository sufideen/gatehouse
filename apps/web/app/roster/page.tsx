import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { complianceBadge } from "@gatehouse/api/compliance";
import { shifts, sites, siteInductions, users } from "@gatehouse/db";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { ActionForm, btnCls, inputCls } from "@/components/action-form";
import { assignAction } from "@/app/actions";
import { db } from "@/lib/db";
import { ADMINS, STAFF, requireRole } from "@/lib/auth";
import { fmt, name } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Roster() {
  const me = await requireRole(STAFF);
  const canAssign = ADMINS.includes(me.role);
  const upcoming = await db.select({ shift: shifts, site: sites.name }).from(shifts).innerJoin(sites, eq(sites.id, shifts.siteId))
    .where(and(gt(shifts.endUtc, new Date()), inArray(shifts.status, ["OPEN", "ASSIGNED"]))).orderBy(asc(shifts.startUtc), asc(sites.name), asc(shifts.id)).limit(12);
  const people = await db.select().from(users).where(inArray(users.role, ["STATIC_GUARD", "PATROL_DRIVER"]));
  const guards = people.filter((p) => p.role === "STATIC_GUARD" || p.role === "PATROL_DRIVER");
  const inductions = await db.select().from(siteInductions);

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-400">{canAssign ? `Signed in as ${me.role}. Assigning an expired-SIA guard (red) is refused; only a COMPLIANCE_ADMIN with a written reason can override. Every attempt is audited.` : "View only: control room staff cannot assign shifts."}</p>
      {upcoming.map(({ shift, site }) => {
        const assigned = guards.find((g) => g.id === shift.guardId);
        return (
          <Card key={shift.id}>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="mb-0">{site} · {shift.shiftType}</CardTitle>
              <span className="text-sm text-slate-300">{fmt(shift.startUtc)} to {fmt(shift.endUtc)}</span>
              {assigned ? <Badge tone="green">Assigned: {name(assigned.firstName, assigned.lastName)}</Badge> : <Badge tone="amber">Open</Badge>}
            </div>
            {canAssign && <ActionForm action={assignAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="shiftId" value={shift.id} />
              <label className="text-xs text-slate-400">Guard
                <select name="guardId" className={`${inputCls} block`}>
                  {guards.map((g) => {
                    const b = complianceBadge({ siaLicenceExpiry: g.siaLicenceExpiry, bs7858VettingStatus: g.bs7858VettingStatus, siteInductionCompleted: inductions.some((i) => i.guardId === g.id && i.siteId === shift.siteId) }, shift.startUtc);
                    return <option key={g.id} value={g.id}>{b === "GREEN" ? "🟢" : b === "AMBER" ? "🟠" : "🔴"} {name(g.firstName, g.lastName)}</option>;
                  })}
                </select>
              </label>
              <label className="text-xs text-slate-400">Override reason (Compliance Admin only)
                <input name="overrideReason" className={`${inputCls} block w-64`} placeholder="Written reason" />
              </label>
              <button className={btnCls}>Assign</button>
            </ActionForm>}
          </Card>
        );
      })}
    </div>
  );
}
