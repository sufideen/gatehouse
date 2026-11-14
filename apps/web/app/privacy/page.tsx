import { and, desc, eq, isNull } from "drizzle-orm";
import { consents } from "@gatehouse/db";
import { ActionForm, btnCls } from "@/components/action-form";
import { Card, CardTitle } from "@/components/ui/card";
import { eraseAction, withdrawAction } from "@/app/pilot-actions";
import { GUARDS, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { fmt } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function MyData() {
  const me = await requireRole(GUARDS);
  const [c] = await db.select().from(consents).where(and(eq(consents.userId, me.id), isNull(consents.withdrawnAt))).orderBy(desc(consents.grantedAt)).limit(1);
  const pilot = me.dataOrigin === "PILOT_CONSENTED";
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <Card>
        <CardTitle>My data</CardTitle>
        {pilot ? (
          <div className="space-y-1 text-sm text-slate-300">
            <p>You joined the pilot with consent version {c?.policyVersion}. Shared: <b>{(c?.scopes ?? []).join(", ") || "nothing"}</b>.</p>
            <p>Your data is automatically deleted on <b>{fmt(me.retentionExpiresAt)}</b>.</p>
          </div>
        ) : <p className="text-sm text-slate-400">This is a synthetic demo account: no real person&apos;s data is held.</p>}
      </Card>
      {pilot && (
        <>
          <Card>
            <CardTitle>Withdraw part of my consent</CardTitle>
            <ActionForm action={withdrawAction} className="space-y-2 text-sm">
              {(c?.scopes ?? []).map((s) => <label key={s} className="block"><input type="checkbox" name={`scope_${s}`} className="mr-2" />{s}{s === "IDENTITY" ? " (withdrawing this deletes my account)" : ""}</label>)}
              <button className={btnCls}>Withdraw selected</button>
            </ActionForm>
          </Card>
          <Card>
            <CardTitle>Download everything we hold</CardTitle>
            <a href="/privacy/export" className={`${btnCls} inline-block`}>Download my data (JSON)</a>
          </Card>
          <Card>
            <CardTitle>Delete my account and data</CardTitle>
            <p className="mb-2 text-sm text-slate-300">Removes your personal details, selfies, audio and incident text. Audit entries remain but contain no personal information.</p>
            <form action={eraseAction}><button className="rounded bg-red-700 px-3 py-1.5 text-sm font-semibold hover:bg-red-600">Delete everything now</button></form>
          </Card>
        </>
      )}
    </div>
  );
}
