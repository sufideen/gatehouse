import "./globals.css";
import Link from "next/link";
import type { Metadata } from "next";
import { ADMINS, GUARDS, STAFF, getSession } from "@/lib/auth";
import { logoutAction } from "@/app/auth-actions";

export const metadata: Metadata = { title: "Gatehouse Control Room", description: "UK static guarding & mobile patrol operations" };
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const me = await getSession();
  const nav: [string, string][] = [];
  if (me) {
    if (STAFF.includes(me.role)) nav.push(["/dashboard", "Dashboard"], ["/roster", "Roster"]);
    if (ADMINS.includes(me.role)) nav.push(["/compliance/audit-logs", "Audit trail"], ["/import/guardhouse", "Guardhouse import"], ["/admin/invites", "Pilot invites"], ["/admin/users", "Account recovery"]);
    if (STAFF.includes(me.role) || me.role === "CLIENT_VIEWER") nav.push(["/client-portal", "Client portal"]);
    if (GUARDS.includes(me.role)) nav.push(["/guard", "My shift"], ["/privacy", "My data"]);
  }
  if (me) nav.push(["/security", "Security"]);
  return (
    <html lang="en-GB" className="dark">
      <body>
        <header className="flex flex-wrap items-center gap-6 border-b border-slate-800 px-6 py-3">
          <Link href="/" className="font-bold tracking-tight">Gatehouse</Link>
          <nav className="flex flex-wrap gap-4 text-sm text-slate-300">
            {nav.map(([href, label]) => <Link key={href} href={href} className="hover:text-white">{label}</Link>)}
          </nav>
          {me && (
            <form action={logoutAction} className="ml-auto flex items-center gap-3 text-xs text-slate-400">
              <span>{me.firstName} · {me.role}{me.dataOrigin === "SYNTHETIC" ? " · demo data" : ""}</span>
              <button className="rounded bg-slate-800 px-2 py-1 hover:bg-slate-700">Sign out</button>
            </form>
          )}
        </header>
        <main className="mx-auto max-w-7xl p-6">{children}</main>
      </body>
    </html>
  );
}
