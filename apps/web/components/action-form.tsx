"use client";
import { useActionState } from "react";
import type { ActionState } from "@/app/actions";

export function ActionForm({ action, children, className }: { action: (s: ActionState, f: FormData) => Promise<ActionState>; children: React.ReactNode; className?: string }) {
  const [state, run, pending] = useActionState(action, null);
  return (
    <form action={run} className={className}>
      {children}
      {pending && <p className="text-xs text-slate-400">Working...</p>}
      {state && (
        <div className={`mt-2 rounded p-2 text-sm ${state.ok ? "bg-emerald-900/40 text-emerald-200" : "bg-red-900/50 text-red-200"}`}>
          <p className="font-semibold">{state.message}</p>
          {state.lines?.map((l, i) => <p key={i} className="break-all text-xs">{l}</p>)}
        </div>
      )}
    </form>
  );
}
export const inputCls = "rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm text-slate-100";
export const btnCls = "rounded bg-sky-600 px-3 py-1.5 text-sm font-semibold hover:bg-sky-500 disabled:opacity-50";
