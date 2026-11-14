import { redirect } from "next/navigation";
import { getSession, homeFor } from "@/lib/auth";

export const dynamic = "force-dynamic";
export default async function Home() {
  const me = await getSession();
  redirect(me ? homeFor(me.role) : "/login");
}
