import { exportSubjectData } from "@gatehouse/api/privacy";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** A signed-in person can only ever export their own data (id comes from the session, not the URL). */
export async function GET() {
  const me = await getSession();
  if (!me) return new Response("Unauthorised", { status: 401 });
  const data = await exportSubjectData(db, me.id);
  return new Response(JSON.stringify(data, null, 2), {
    headers: { "content-type": "application/json", "content-disposition": 'attachment; filename="my-data.json"', "cache-control": "no-store" },
  });
}
