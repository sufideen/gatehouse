import { desc, eq } from "drizzle-orm";
import { immutableAuditLogs } from "@gatehouse/db";
import { Card, CardTitle } from "@/components/ui/card";
import { db } from "@/lib/db";
import { ADMINS, requireRole } from "@/lib/auth";
import { fmt } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AuditLogs({ searchParams }: { searchParams: Promise<{ action?: string }> }) {
  await requireRole(ADMINS);
  const { action } = await searchParams;
  const all = await db.select().from(immutableAuditLogs).orderBy(desc(immutableAuditLogs.utcTimestamp)).limit(500);
  const actions = [...new Set(all.map((a) => a.action))].sort();
  const rows = (action ? all.filter((a) => a.action === action) : all).slice(0, 100);
  return (
    <Card>
      <CardTitle>Immutable audit trail (read-only; database triggers block UPDATE/DELETE)</CardTitle>
      <div className="mb-3 flex flex-wrap gap-2 text-xs">
        <a href="?" className="rounded bg-slate-700 px-2 py-1">All</a>
        {actions.map((a) => <a key={a} href={`?action=${a}`} className={`rounded px-2 py-1 ${a === action ? "bg-sky-600" : "bg-slate-800"}`}>{a}</a>)}
      </div>
      <table className="w-full text-left text-xs">
        <thead className="text-slate-400"><tr><th>When</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-slate-800 align-top">
              <td className="py-1 pr-2 whitespace-nowrap">{fmt(r.utcTimestamp)}</td>
              <td className={`pr-2 font-semibold ${/BLOCK|OVERRIDE/.test(r.action) ? "text-amber-300" : ""}`}>{r.action}</td>
              <td className="pr-2">{r.entityType}<br /><span className="text-slate-500">{r.entityId.slice(0, 8)}</span></td>
              <td className="break-all text-slate-300">{JSON.stringify(r.newValuesJson)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
