import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { attendanceLogs, checkpoints, patrolLogs, shifts, sites, users } from "@gatehouse/db";
import { Card, CardTitle } from "@/components/ui/card";
import { ActionForm, btnCls, inputCls } from "@/components/action-form";
import { guardAction } from "@/app/actions";
import { db } from "@/lib/db";
import { GUARDS, requireRole } from "@/lib/auth";
import { fmt, name } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function GuardSim({ searchParams }: { searchParams: Promise<{ shift?: string }> }) {
  const me = await requireRole(GUARDS);
  const { shift: pick } = await searchParams;
  const mine = await db.select({ s: shifts, site: sites, g: users }).from(shifts).innerJoin(sites, eq(sites.id, shifts.siteId)).innerJoin(users, eq(users.id, shifts.guardId))
    .where(and(eq(shifts.guardId, me.id), inArray(shifts.status, ["ASSIGNED", "IN_PROGRESS"]))).orderBy(asc(shifts.startUtc));
  if (!mine.length) return <Card><CardTitle>Guard simulator</CardTitle><p className="text-sm">No shifts assigned to you yet. Ask a controller to assign one (signed in as admin, use Roster).</p></Card>;
  const cur = mine.find((m) => m.s.id === pick) ?? mine[0]!;
  const cps = await db.select().from(checkpoints).where(eq(checkpoints.siteId, cur.site.id));
  const [att] = await db.select().from(attendanceLogs).where(eq(attendanceLogs.shiftId, cur.s.id));
  const scans = await db.select().from(patrolLogs).where(eq(patrolLogs.shiftId, cur.s.id)).orderBy(sql`${patrolLogs.scannedUtc} desc`).limit(5);
  const [c] = (await db.execute<{ lat: number; lng: number }>(sql`select ST_Y(centre::geometry) lat, ST_X(centre::geometry) lng from sites where id = ${cur.site.id}`));
  const hidden = (<>
    <input type="hidden" name="shiftId" value={cur.s.id} /><input type="hidden" name="siteId" value={cur.site.id} />
    <input type="hidden" name="siteLat" value={c!.lat} /><input type="hidden" name="siteLng" value={c!.lng} />
  </>);

  return (
    <div className="mx-auto max-w-md space-y-3">
      <div className="flex flex-wrap gap-2 text-xs">
        {mine.map((m) => <a key={m.s.id} href={`?shift=${m.s.id}`} className={`rounded px-2 py-1 ${m.s.id === cur.s.id ? "bg-sky-600" : "bg-slate-800"}`}>{name(m.g.firstName, m.g.lastName)} @ {m.site.name}</a>)}
      </div>
      <Card>
        <CardTitle>Guard phone (browser simulator)</CardTitle>
        <p className="text-sm">{name(cur.g.firstName, cur.g.lastName)} · {cur.site.name}</p>
        <p className="text-xs text-slate-400">{fmt(cur.s.startUtc)} · {cur.s.status} · {att ? `clocked in ${fmt(att.clockInUtc)}` : "not clocked in"}</p>
      </Card>
      <Card>
        <CardTitle>Clock in (geofence + selfie)</CardTitle>
        <ActionForm action={guardAction} className="space-y-2">
          {hidden}<input type="hidden" name="kind" value="CLOCK_IN" />
          <select name="where" className={inputCls}><option value="inside">Standing on site</option><option value="outside">~700 m away from site</option></select>
          <label className="block text-sm"><input type="checkbox" name="selfie" defaultChecked className="mr-2" />Live selfie captured</label>
          <button className={btnCls}>Clock in</button>
        </ActionForm>
        {att && !att.clockOutUtc && (
          <ActionForm action={guardAction} className="mt-3">
            {hidden}<input type="hidden" name="kind" value="CLOCK_OUT" /><input type="hidden" name="attendanceSyncUuid" value={att.syncUuid} /><input type="hidden" name="where" value="inside" />
            <button className={btnCls}>Clock out</button>
          </ActionForm>
        )}
      </Card>
      <Card>
        <CardTitle>Scan checkpoint (legacy tag IDs work)</CardTitle>
        <ActionForm action={guardAction} className="flex flex-wrap items-end gap-2">
          {hidden}<input type="hidden" name="kind" value="PATROL_SCAN" /><input type="hidden" name="where" value="inside" />
          <select name="tagUid" className={inputCls}>{cps.map((k) => <option key={k.id} value={k.externalTagUid}>{k.name} ({k.externalTagUid})</option>)}<option value="UNKNOWN-TAG">Unknown tag</option></select>
          <button className={btnCls}>Scan</button>
        </ActionForm>
        <ul className="mt-2 text-xs text-slate-400">{scans.map((s) => <li key={s.id}>{fmt(s.scannedUtc)} · {s.scannedTagUid}</li>)}</ul>
      </Card>
      <Card>
        <CardTitle>Welfare &amp; SOS</CardTitle>
        <div className="flex gap-2">
          <ActionForm action={guardAction}>{hidden}<input type="hidden" name="kind" value="SAFE" /><button className="rounded bg-emerald-600 px-4 py-3 font-bold">I AM SAFE</button></ActionForm>
          <ActionForm action={guardAction}>{hidden}<input type="hidden" name="kind" value="SOS" /><button className="rounded bg-red-600 px-4 py-3 font-bold">SOS</button></ActionForm>
        </div>
      </Card>
      <Card>
        <CardTitle>Incident</CardTitle>
        <ActionForm action={guardAction} className="space-y-2">
          {hidden}<input type="hidden" name="kind" value="INCIDENT" />
          <select name="category" className={inputCls}>{["Trespass", "Theft", "Damage", "Aggression", "Other"].map((x) => <option key={x}>{x}</option>)}</select>
          <textarea name="transcript" className={`${inputCls} w-full`} placeholder="Describe the incident" />
          <button className={btnCls}>Save incident</button>
        </ActionForm>
      </Card>
    </div>
  );
}
