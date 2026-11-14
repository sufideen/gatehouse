import "./globals.css";
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Gatehouse Control Room", description: "UK static guarding & mobile patrol operations" };
const nav = [["/dashboard", "Dashboard"], ["/roster", "Roster"], ["/compliance/audit-logs", "Audit trail"], ["/import/guardhouse", "Guardhouse import"], ["/client-portal", "Client portal"]] as const;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" className="dark">
      <body>
        <header className="flex items-center gap-6 border-b border-slate-800 px-6 py-3">
          <Link href="/" className="font-bold tracking-tight">Gatehouse</Link>
          <nav className="flex gap-4 text-sm text-slate-300">
            {nav.map(([href, label]) => <Link key={href} href={href} className="hover:text-white">{label}</Link>)}
          </nav>
        </header>
        <main className="mx-auto max-w-7xl p-6">{children}</main>
      </body>
    </html>
  );
}
