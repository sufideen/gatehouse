import Link from "next/link";
import { ActionForm, btnCls, inputCls } from "@/components/action-form";
import { Card, CardTitle } from "@/components/ui/card";
import { loginAction } from "@/app/auth-actions";

const DEMO = [
  ["Admin", "admin@thamesshield.example"], ["Compliance admin", "compliance@thamesshield.example"], ["Control room", "controlroom@thamesshield.example"],
  ["Guard (compliant)", "fatima.khan@thamesshield.example"], ["Client viewer", "client1@demo.example"],
];

export default async function Login({ searchParams }: { searchParams: Promise<{ reset?: string }> }) {
  const { reset } = await searchParams;
  return (
    <div className="mx-auto max-w-sm space-y-4">
      {reset && <p className="rounded bg-emerald-900/40 p-2 text-sm text-emerald-200">Password changed. Sign in with the new one.</p>}
      <Card>
        <CardTitle>Sign in</CardTitle>
        <ActionForm action={loginAction} className="space-y-3">
          <input name="email" type="email" required autoComplete="username" placeholder="Email" className={`${inputCls} w-full`} />
          <input name="password" type="password" required autoComplete="current-password" placeholder="Password" className={`${inputCls} w-full`} />
          <button className={btnCls}>Sign in</button>
        </ActionForm>
        <p className="mt-3 text-xs"><Link href="/forgot-password" className="text-slate-400 underline">Forgot password?</Link></p>
      </Card>
      {process.env.NODE_ENV !== "production" && (
        <Card>
          <CardTitle>Demo accounts (synthetic data)</CardTitle>
          <p className="mb-2 text-xs text-slate-400">Password for all: demo-password-1. Staff accounts must set up an authenticator on first sign-in.</p>
          <ul className="space-y-1 text-xs text-slate-300">{DEMO.map(([r, e]) => <li key={e}><span className="text-slate-500">{r}:</span> {e}</li>)}</ul>
          <p className="mt-2 text-xs"><Link href="/dev/outbox" className="text-slate-400 underline">Dev inbox (reset emails)</Link></p>
        </Card>
      )}
    </div>
  );
}
