import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { alerts, liveShifts } from "@/lib/demo-data";

export default function Dashboard() {
  return (
    <div className="space-y-6">
      <section aria-live="assertive" className="space-y-2">
        {alerts.sos.map((a) => (
          <div key={a.guard} className="animate-pulse rounded bg-red-600 p-3 font-bold">SOS: {a.guard} at {a.site}</div>
        ))}
        {alerts.welfareOverdue.map((a) => (
          <div key={a.guard} className="rounded bg-red-700/80 p-3 font-semibold">Welfare overdue ({a.minsLate} min): {a.guard}, {a.site}</div>
        ))}
        {alerts.scansOverdue.map((a) => (
          <div key={a.checkpoint} className="rounded bg-amber-600/30 p-3 text-amber-200">Checkpoint overdue ({a.minsLate} min): {a.checkpoint}, {a.site}</div>
        ))}
      </section>
      <Card>
        <CardTitle>Live shift &amp; geofence monitor</CardTitle>
        <table className="w-full text-left text-sm">
          <thead className="text-slate-400"><tr><th>Guard</th><th>Site</th><th>Progress</th><th>Selfie</th><th>From site</th><th>Next welfare</th></tr></thead>
          <tbody>
            {liveShifts.map((s) => (
              <tr key={s.guard} className="border-t border-slate-800">
                <td className="py-2">{s.guard}</td><td>{s.site}</td><td>{s.progress}%</td>
                <td>{s.selfie ? <Badge tone="green">Verified</Badge> : <Badge tone="red">Missing</Badge>}</td>
                <td><Badge tone={s.distanceM <= 75 ? "green" : "red"}>{s.distanceM} m</Badge></td>
                <td className={s.nextWelfare === "OVERDUE" ? "font-bold text-red-400" : ""}>{s.nextWelfare}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
