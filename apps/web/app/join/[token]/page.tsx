import { findOpenInvite } from "@gatehouse/api/pilot";
import { ActionForm, btnCls, inputCls } from "@/components/action-form";
import { Card, CardTitle } from "@/components/ui/card";
import { joinAction } from "@/app/pilot-actions";
import { NOTICE } from "@/lib/policy";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Join({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await findOpenInvite(db, token);
  if (!invite) return <Card><CardTitle>Invite not valid</CardTitle><p className="text-sm text-slate-300">This link is invalid, already used or has expired. Ask your controller for a new one.</p></Card>;
  if (process.env.ALLOW_PILOT_DATA !== "true") return <Card><CardTitle>Pilot not open</CardTitle><p className="text-sm text-slate-300">This deployment is not enabled for real participant data.</p></Card>;

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <Card>
        <CardTitle>Join the Gatehouse pilot</CardTitle>
        <div className="space-y-2 text-sm text-slate-300">
          {NOTICE.map((n) => <p key={n.title}><b>{n.title}:</b> {n.body}</p>)}
        </div>
      </Card>
      <Card>
        <ActionForm action={joinAction} className="space-y-3">
          <input type="hidden" name="token" value={token} />
          <div className="grid grid-cols-2 gap-2">
            <input name="firstName" required placeholder="First name" className={inputCls} />
            <input name="lastName" required placeholder="Last name" className={inputCls} />
          </div>
          <input name="email" type="email" required placeholder="Work email" autoComplete="username" className={`${inputCls} w-full`} />
          <input name="password" type="password" required minLength={12} placeholder="Choose a password (12+ characters)" autoComplete="new-password" className={`${inputCls} w-full`} />
          <fieldset className="space-y-2 rounded border border-slate-700 p-3 text-sm">
            <legend className="px-1 text-xs text-slate-400">What I agree to share</legend>
            <label className="block"><input type="checkbox" name="scope_IDENTITY" className="mr-2" required />Name and work email (required to take part)</label>
            <label className="block"><input type="checkbox" name="scope_CONTACT" className="mr-2" />Mobile number</label>
            <input name="mobile" placeholder="Mobile (only saved if ticked)" className={`${inputCls} w-full`} />
            <label className="block"><input type="checkbox" name="scope_SIA_DETAILS" className="mr-2" />SIA badge number and expiry</label>
            <div className="grid grid-cols-2 gap-2">
              <input name="siaBadgeNumber" placeholder="SIA number" className={inputCls} />
              <input name="siaLicenceExpiry" type="date" className={inputCls} />
            </div>
          </fieldset>
          <button className={btnCls}>I consent: create my account</button>
        </ActionForm>
      </Card>
    </div>
  );
}
