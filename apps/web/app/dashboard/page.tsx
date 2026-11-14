import { sql } from "drizzle-orm";
import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { fmt, name } from "@/lib/format";

export const dynamic = "force-dynamic";

type Live = { shift_id: string; first_name: string | null; last_name: string | null; site: string; status: string; start_utc: Date; end_utc: Date; clock_in_utc: Date | null; dist: number | null; selfie: string | null; last_scan: Date | null; radius: number; next_welfare: Date | null };

export default async function Dashboard() {
  const live = await db.execute<Live>(sql`
    SELECT s.id shift_id, u.first_name, u.last_name, si.name site, s.status, s.start_utc, s.end_utc, si.radius_meters radius,
           a.clock_in_utc, a.clock_in_selfie_s3_key selfie, round(ST_Distance(a.clock_in_gps, si.centre))::int dist,
           (SELECT max(scanned_utc) FROM patrol_logs p WHERE p.shift_id = s.id) last_scan,
           (SELECT min(due_utc) FROM welfare_checks w WHERE w.shift_id = s.id AND w.confirmed_utc IS NULL AND w.status='PENDING') next_welfare
    FROM shifts s JOIN sites si ON si.id = s.site_id LEFT JOIN users u ON u.id = s.guard_id LEFT JOIN attendance_logs a ON a.shift_id = s.id
    WHERE s.status = 'IN_PROGRESS' ORDER BY s.start_utc`);
  const sos = await db.execute<{ id: string; first_name: string; last_name: string; site: string; due_utc: Date; status: string }>(sql`
    SELECT w.id, u.first_name, u.last_name, si.name site, w.due_utc, w.status FROM welfare_checks w
    JOIN shifts s ON s.id = w.shift_id JOIN sites si ON si.id = s.site_id JOIN users u ON u.id = s.guard_id
    WHERE w.status IN ('SOS_TRIGGERED','OVERDUE') AND w.due_utc > now() - interval '24 hours' ORDER BY w.due_utc DESC`);
  const recent = await db.execute<{ site: string; first_name: string; last_name: string; scans: number; start_utc: Date }>(sql`
    SELECT si.name site, u.first_name, u.last_name, s.start_utc, (SELECT count(*)::int FROM patrol_logs p WHERE p.shift_id = s.id) scans
    FROM shifts s JOIN sites si ON si.id = s.site_id JOIN users u ON u.id = s.guard_id WHERE s.status = 'COMPLETED' ORDER BY s.start_utc DESC LIMIT 8`);
  const overdueScans = live.filter((l) => !l.last_scan || Date.now() - new Date(l.last_scan).getTime() > 15 * 60_000);

  return (
    <div className="space-y-6">
      <section aria-live="assertive" className="space-y-2">
        {sos.map((a) => (
          <div key={a.id} className={`rounded p-3 font-bold ${a.status === "SOS_TRIGGERED" ? "animate-pulse bg-red-600" : "bg-red-700/80"}`}>
            {a.status === "SOS_TRIGGERED" ? "SOS" : "Welfare overdue"}: {name(a.first_name, a.last_name)} at {a.site} ({fmt(a.due_utc)})
          </div>
        ))}
        {overdueScans.map((l) => (
          <div key={l.shift_id} className="rounded bg-amber-600/30 p-3 text-amber-200">No checkpoint scan in 15+ min: {name(l.first_name, l.last_name)}, {l.site}</div>
        ))}
        {!sos.length && !overdueScans.length && <div className="rounded bg-emerald-900/30 p-3 text-emerald-300">No active alerts</div>}
      </section>
      <Card>
        <CardTitle>Live shift &amp; geofence monitor ({live.length} on duty)</CardTitle>
        {live.length === 0 && <p className="text-sm text-slate-400">Nobody clocked in. Use the <a className="underline" href="/guard">guard simulator</a> (assign a shift in <a className="underline" href="/roster">Roster</a> first).</p>}
        <table className="w-full text-left text-sm">
          <thead className="text-slate-400"><tr><th>Guard</th><th>Site</th><th>Clocked in</th><th>Selfie</th><th>From site</th><th>Last scan</th></tr></thead>
          <tbody>
            {live.map((l) => (
              <tr key={l.shift_id} className="border-t border-slate-800">
                <td className="py-2">{name(l.first_name, l.last_name)}</td><td>{l.site}</td><td>{fmt(l.clock_in_utc)}</td>
                <td>{l.selfie ? <Badge tone="green">Verified</Badge> : <Badge tone="red">Missing</Badge>}</td>
                <td>{l.dist !== null && <Badge tone={l.dist <= l.radius ? "green" : "red"}>{l.dist} m</Badge>}</td>
                <td>{fmt(l.last_scan)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card>
        <CardTitle>Recently completed shifts</CardTitle>
        <ul className="text-sm text-slate-300">
          {recent.map((r, i) => <li key={i} className="border-t border-slate-800 py-1">{fmt(r.start_utc)} · {r.site} · {name(r.first_name, r.last_name)} · {r.scans} scans</li>)}
        </ul>
      </Card>
    </div>
  );
}
