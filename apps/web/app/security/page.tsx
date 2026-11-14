import QRCode from "qrcode";
import { getPendingMfa } from "@gatehouse/api/account";
import { ActionForm, btnCls, inputCls } from "@/components/action-form";
import { Card, CardTitle } from "@/components/ui/card";
import { beginMfaAction, changePasswordAction, confirmMfaAction, disableMfaAction } from "@/app/security-actions";
import { MFA_REQUIRED, mfaSetupRequired, requireUser, secret } from "@/lib/auth";
import { db } from "@/lib/db";
import { fmt } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Security({ searchParams }: { searchParams: Promise<{ recovery?: string; mfa?: string }> }) {
  const me = await requireUser();
  const { recovery, mfa } = await searchParams;
  const required = MFA_REQUIRED.includes(me.role);
  const pending = !me.mfaEnabledAt ? await getPendingMfa(db, { userId: me.id, masterKey: secret() }) : null;
  const qr = pending ? await QRCode.toDataURL(pending.uri, { margin: 1, width: 200 }) : null;

  return (
    <div className="mx-auto max-w-lg space-y-4">
      {mfaSetupRequired(me) && <p className="rounded bg-amber-900/40 p-3 text-sm text-amber-200">Your role requires two-step verification. Set it up below to continue.</p>}
      {mfa === "off" && <p className="rounded bg-emerald-900/40 p-3 text-sm text-emerald-200">MFA turned off. Other devices were signed out.</p>}
      {recovery && <p className="rounded bg-amber-900/40 p-3 text-sm text-amber-200">You signed in with a recovery code ({me.mfaRecoveryHashes.length} left). Consider asking an admin to reset your MFA so you can enrol a new device and fresh codes.</p>}

      <Card>
        <CardTitle>Two-step verification</CardTitle>
        {me.mfaEnabledAt ? (
          <div className="space-y-3 text-sm text-slate-300">
            <p>On since {fmt(me.mfaEnabledAt)}. Recovery codes left: <b>{me.mfaRecoveryHashes.length}</b>.</p>
            {required
              ? <p className="text-xs text-slate-400">Mandatory for your role. If you lose your device, an administrator can reset it.</p>
              : (
                <ActionForm action={disableMfaAction} className="flex gap-2">
                  <input name="password" type="password" required placeholder="Password to confirm" className={inputCls} />
                  <button className="rounded bg-red-700 px-3 py-1.5 text-sm font-semibold hover:bg-red-600">Turn off</button>
                </ActionForm>
              )}
          </div>
        ) : pending ? (
          <div className="space-y-3 text-sm text-slate-300">
            <p>1. Scan this with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy).</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr!} alt="Authenticator QR code" width={200} height={200} className="rounded bg-white" />
            <p className="break-all text-xs text-slate-400">Can&apos;t scan? Enter this key manually: <code className="text-slate-200">{pending.secret}</code></p>
            <p>2. Enter the 6-digit code it shows:</p>
            <ActionForm action={confirmMfaAction} className="flex gap-2">
              <input name="code" required inputMode="numeric" pattern="\d{6}" maxLength={6} autoComplete="one-time-code" placeholder="123456" className={`${inputCls} w-32 tracking-widest`} />
              <button className={btnCls}>Turn on</button>
            </ActionForm>
          </div>
        ) : (
          <form action={beginMfaAction} className="space-y-2 text-sm text-slate-300">
            <p>{required ? "Required for your role." : "Optional, but recommended."} Adds a code from your phone when you sign in.</p>
            <button className={btnCls}>Set up authenticator</button>
          </form>
        )}
      </Card>

      <Card>
        <CardTitle>Change password</CardTitle>
        <ActionForm action={changePasswordAction} className="space-y-2">
          <input name="current" type="password" required autoComplete="current-password" placeholder="Current password" className={`${inputCls} w-full`} />
          <input name="next" type="password" required minLength={12} autoComplete="new-password" placeholder="New password (12+ characters)" className={`${inputCls} w-full`} />
          <input name="confirm" type="password" required minLength={12} autoComplete="new-password" placeholder="Repeat new password" className={`${inputCls} w-full`} />
          <button className={btnCls}>Change password</button>
        </ActionForm>
      </Card>
    </div>
  );
}
