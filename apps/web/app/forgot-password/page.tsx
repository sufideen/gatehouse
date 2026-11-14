import Link from "next/link";
import { ActionForm, btnCls, inputCls } from "@/components/action-form";
import { Card, CardTitle } from "@/components/ui/card";
import { forgotPasswordAction } from "@/app/auth-actions";

export default function Forgot() {
  return (
    <div className="mx-auto max-w-sm">
      <Card>
        <CardTitle>Reset your password</CardTitle>
        <ActionForm action={forgotPasswordAction} className="space-y-3">
          <input name="email" type="email" required placeholder="Your email" className={`${inputCls} w-full`} />
          <button className={btnCls}>Email me a reset link</button>
        </ActionForm>
        <p className="mt-3 text-xs text-slate-400">No email access? Ask an administrator for a one-time link. If you use an authenticator, resetting your password does not remove it.</p>
        <p className="mt-2 text-xs"><Link href="/login" className="underline">Back to sign in</Link></p>
      </Card>
    </div>
  );
}
