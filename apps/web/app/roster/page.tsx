import { Badge } from "@/components/ui/badge";
import { Card, CardTitle } from "@/components/ui/card";
import { roster } from "@/lib/demo-data";

export default function Roster() {
  return (
    <Card>
      <div className="flex items-center justify-between">
        <CardTitle>Roster compliance</CardTitle>
        <button className="rounded bg-sky-600 px-3 py-1.5 text-sm font-semibold hover:bg-sky-500">Broadcast open shift to relief pool</button>
      </div>
      <ul className="divide-y divide-slate-800">
        {roster.map((r) => (
          <li key={r.guard} className="flex items-center justify-between py-2">
            <span>{r.guard}</span>
            <Badge tone={r.badge}>{r.badge === "green" ? "Compliant" : r.badge === "amber" ? "Expiring" : "Blocked"} · {r.note}</Badge>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-slate-500">Drag-and-drop calendar is next; blocked guards will be rejected server-side by assignGuardToShift regardless of UI.</p>
    </Card>
  );
}
