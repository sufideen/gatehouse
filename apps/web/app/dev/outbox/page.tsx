import { notFound } from "next/navigation";
import { Card, CardTitle } from "@/components/ui/card";
import { dev } from "@/lib/auth";
import { fmt } from "@/lib/format";

export const dynamic = "force-dynamic";

/** Development only: shows the emails the dev mailer would have sent. Does not exist in production. */
export default function Outbox() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <Card>
      <CardTitle>Dev inbox</CardTitle>
      {!dev.outbox.length && <p className="text-sm text-slate-400">No messages yet.</p>}
      {dev.outbox.map((m, i) => (
        <div key={i} className="border-t border-slate-800 py-2 text-sm">
          <p className="text-slate-400">{fmt(m.at)} · to {m.to} · {m.subject}</p>
          <pre className="whitespace-pre-wrap break-all text-xs text-slate-200">{m.text}</pre>
        </div>
      ))}
    </Card>
  );
}
