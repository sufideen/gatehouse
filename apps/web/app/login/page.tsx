import { ActionForm, btnCls, inputCls } from "@/components/action-form";
import { Card, CardTitle } from "@/components/ui/card";
import { loginAction } from "@/app/auth-actions";

const DEMO = [
  ["Admin", "admin@thamesshield.example"], ["Compliance admin", "compliance@thamesshield.example"], ["Control room", "controlroom@thamesshield.example"],
  ["Guard (compliant)", "fatima.khan@thamesshield.example"], ["Client viewer", "client1@demo.example"],
];

export default function Login() {
  return (
    <div className="mx-auto max-w-sm space-y-4">
      <Card>
        <CardTitle>Sign in</CardTitle>
        <ActionForm action={loginAction} className="space-y-3">
          <input name="email" type="email" required autoComplete="username" placeholder="Email" className={`${inputCls} w-full`} />
          <input name="password" type="password" required autoComplete="current-password" placeholder="Password" className={`${inputCls} w-full`} />
          <button className={btnCls}>Sign in</button>
        </ActionForm>
      </Card>
      {process.env.NODE_ENV !== "production" && (
        <Card>
          <CardTitle>Demo accounts (synthetic data)</CardTitle>
          <p className="mb-2 text-xs text-slate-400">Password for all: demo-password-1</p>
          <ul className="space-y-1 text-xs text-slate-300">{DEMO.map(([r, e]) => <li key={e}><span className="text-slate-500">{r}:</span> {e}</li>)}</ul>
        </Card>
      )}
    </div>
  );
}
