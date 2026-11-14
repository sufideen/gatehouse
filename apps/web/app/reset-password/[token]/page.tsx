import { findOpenReset } from "@gatehouse/api/account";
import { ActionForm, btnCls, inputCls } from "@/components/action-form";
import { Card, CardTitle } from "@/components/ui/card";
import { resetPasswordAction } from "@/app/auth-actions";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function ResetPassword({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!(await findOpenReset(db, token))) {
    return <Card><CardTitle>Link not valid</CardTitle><p className="text-sm text-slate-300">This reset link is invalid, already used or has expired. Request a new one from the sign-in page.</p></Card>;
  }
  return (
    <div className="mx-auto max-w-sm">
      <Card>
        <CardTitle>Choose a new password</CardTitle>
        <ActionForm action={resetPasswordAction} className="space-y-3">
          <input type="hidden" name="token" value={token} />
          <input name="password" type="password" required minLength={12} autoComplete="new-password" placeholder="New password (12+ characters)" className={`${inputCls} w-full`} />
          <input name="confirm" type="password" required minLength={12} autoComplete="new-password" placeholder="Repeat new password" className={`${inputCls} w-full`} />
          <button className={btnCls}>Set password</button>
        </ActionForm>
        <p className="mt-3 text-xs text-slate-400">All devices will be signed out.</p>
      </Card>
    </div>
  );
}
