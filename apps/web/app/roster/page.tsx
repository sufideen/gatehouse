import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { complianceBadge } from "@gatehouse/api/compliance";
import { shifts, sites, siteInductions, users } from "@gatehouse/db";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { ActionForm, btnCls, inputCls } from "@/components/action-form";
import { assignAction } from "@/app/actions";
import { db } from "@/lib/db";
import { fmt, name } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Roster() {
  const upcoming = await db.select({ shift: shifts, site: sites.name }).from(shifts).innerJoin(sites, eq(sites.id, shifts.siteId))
    .where(and(gt(shifts.endUtc, new Date()), inArray(shifts.status, ["OPEN", "ASSIGNED"]))).orderBy(asc(shifts.startUtc)).limit(12);
  const people = await db.select().from(users).where(inArray(users.role, ["STATIC_GUARD", "PATROL_DRIVER", "ADMIN", "COMPLIANCE_ADMIN"]));
  const guards = people.filter((p) => p.role === "STATIC_GUARD" || p.role === "PATROL_DRIVER");
  const actors = people.filter((p) => p.role === "ADMIN" || p.role === "COMPLIANCE_ADMIN");
  const inductions = await db.select().from(siteInductions);

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-400">Try assigning the expired-SIA guards (red). A plain Admin is refused; a Compliance Admin needs a written reason. Every attempt lands in the audit trail.</p>
      {upcoming.map(({ shift, site }) => {
        const assigned = guards.find((g) => g.id === shift.guardId);
        return (
          <Card key={shift.id}>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="mb-0">{site} · {shift.shiftType}</CardTitle>
              <span className="text-sm text-slate-300">{fmt(shift.startUtc)} to {fmt(shift.endUtc)}</span>
              {assigned ? <Badge tone="green">Assigned: {name(assigned.firstName, assigned.lastName)}</Badge> : <Badge tone="amber">Open</Badge>}
            </div>
            <ActionForm action={assignAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="shiftId" value={shift.id} />
              <label className="text-xs text-slate-400">Guard
                <select name="guardId" className={`${inputCls} block`}>
                  {guards.map((g) => {
                    const b = complianceBadge({ siaLicenceExpiry: g.siaLicenceExpiry, bs7858VettingStatus: g.bs7858VettingStatus, siteInductionCompleted: inductions.some((i) => i.guardId === g.id && i.siteId === shift.siteId) }, shift.startUtc);
                    return <option key={g.id} value={g.id}>{b === "GREEN" ? "🟢" : b === "AMBER" ? "🟠" : "🔴"} {name(g.firstName, g.lastName)}</option>;
                  })}
                </select>
              </label>
              <label className="text-xs text-slate-400">Acting as
                <select name="actorId" className={`${inputCls} block`}>{actors.map((a) => <option key={a.id} value={a.id}>{a.role}: {a.firstName}</option>)}</select>
              </label>
              <label className="text-xs text-slate-400">Override reason (Compliance Admin only)
                <input name="overrideReason" className={`${inputCls} block w-64`} placeholder="Written reason" />
              </label>
              <button className={btnCls}>Assign</button>
            </ActionForm>
          </Card>
        );
      })}
    </div>
  );
}
