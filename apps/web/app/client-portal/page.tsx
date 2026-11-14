import { and, desc, eq, inArray } from "drizzle-orm";
import { incidentReports, organisations, patrolLogs, shifts, sites, users } from "@gatehouse/db";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { fmt } from "@/lib/format";
import { requireRole, STAFF } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function ClientPortal({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  const me = await requireRole([...STAFF, "CLIENT_VIEWER"]);
  const isViewer = me.role === "CLIENT_VIEWER";
  // A client viewer is locked to their own organisation: the ?client= parameter is ignored for them.
  const client = isViewer ? (me.clientOrganisationId ?? "none") : (await searchParams).client;
  const clientIds = (await db.selectDistinct({ id: sites.clientId }).from(sites)).map((c) => c.id).filter((x): x is string => !!x);
  const clients = await db.select().from(organisations).where(inArray(organisations.id, isViewer ? clientIds.filter((c) => c === me.clientOrganisationId) : clientIds));
  const current = clients.find((c) => c.id === client) ?? clients[0];
  if (!current) return <p>No clients.</p>;
  // Strict scoping: everything below is filtered by the selected client's sites only.
  const mySites = await db.select().from(sites).where(eq(sites.clientId, current.id));
  const siteIds = mySites.map((s) => s.id);
  const onDuty = await db.select({ site: shifts.siteId, first: users.firstName, sia: users.siaLicenceExpiry, vet: users.bs7858VettingStatus })
    .from(shifts).innerJoin(users, eq(users.id, shifts.guardId)).where(and(inArray(shifts.siteId, siteIds), eq(shifts.status, "IN_PROGRESS")));
  const patrols = await db.select({ t: patrolLogs.scannedUtc, site: sites.name, tag: patrolLogs.scannedTagUid }).from(patrolLogs)
    .innerJoin(shifts, eq(shifts.id, patrolLogs.shiftId)).innerJoin(sites, eq(sites.id, shifts.siteId)).where(inArray(shifts.siteId, siteIds)).orderBy(desc(patrolLogs.scannedUtc)).limit(10);
  const incidents = await db.select().from(incidentReports).where(and(inArray(incidentReports.siteId, siteIds), eq(incidentReports.clientVisible, true))).orderBy(desc(incidentReports.reportedUtc)).limit(5);

  return (
    <div className="space-y-4">
      {!isViewer && <div className="flex flex-wrap gap-2 text-xs">
        <span className="text-slate-400">View as client:</span>
        {clients.map((c) => <a key={c.id} href={`?client=${c.id}`} className={`rounded px-2 py-1 ${c.id === current.id ? "bg-sky-600" : "bg-slate-800"}`}>{c.name}</a>)}
      </div>}
      <Card>
        <CardTitle>{current.name}: site coverage</CardTitle>
        {mySites.map((s) => {
          const g = onDuty.find((o) => o.site === s.id);
          return (
            <div key={s.id} className="flex items-center justify-between border-t border-slate-800 py-2 text-sm">
              <span>{s.name}</span>
              {g ? <span><Badge tone="green">Site Secured - Officer On Duty</Badge> <Badge tone={g.vet === "VERIFIED" ? "green" : "amber"}>SIA {g.sia && g.sia > new Date() ? "licence valid" : "check"}</Badge></span> : <Badge tone="neutral">No officer currently clocked in</Badge>}
            </div>
          );
        })}
        <p className="mt-2 text-xs text-slate-500">Guard names, addresses and contact details are never shown here.</p>
      </Card>
      <Card><CardTitle>Recent patrol checkpoints</CardTitle>
        <ul className="text-sm text-slate-300">{patrols.map((p, i) => <li key={i} className="border-t border-slate-800 py-1">{fmt(p.t)} · {p.site} · tag {p.tag}</li>)}</ul></Card>
      <Card><CardTitle>Approved incident reports</CardTitle>
        <ul className="text-sm text-slate-300">{incidents.map((i) => <li key={i.id} className="border-t border-slate-800 py-1">{fmt(i.reportedUtc)} · {i.category} · {i.severity} · {i.transcriptText}</li>)}
          {!incidents.length && <li className="text-slate-500">None</li>}</ul></Card>
    </div>
  );
}
