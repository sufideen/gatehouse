import { redirect } from "next/navigation";
import { ActionForm, btnCls, inputCls } from "@/components/action-form";
import { Card, CardTitle } from "@/components/ui/card";
import { mfaLoginAction } from "@/app/auth-actions";
import { pendingMfaUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function MfaLogin() {
  if (!(await pendingMfaUser())) redirect("/login"); // no password step done (or it expired after 5 minutes)
  return (
    <div className="mx-auto max-w-sm">
      <Card>
        <CardTitle>Two-step verification</CardTitle>
        <p className="mb-3 text-sm text-slate-300">Enter the 6-digit code from your authenticator app, or one of your recovery codes.</p>
        <ActionForm action={mfaLoginAction} className="space-y-3">
          <input name="code" required autoFocus autoComplete="one-time-code" inputMode="text" placeholder="123456 or ABCDE-FGHJK" className={`${inputCls} w-full tracking-widest`} />
          <button className={btnCls}>Verify</button>
        </ActionForm>
      </Card>
    </div>
  );
}
