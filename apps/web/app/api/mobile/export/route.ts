import { exportSubjectData } from "@gatehouse/api/privacy";
import { db } from "@/lib/db";
import { json, mobileUser, unauthorised } from "@/lib/mobile-auth";

export const dynamic = "force-dynamic";
/** Own data only: the id comes from the token, never from the URL. */
export async function GET(req: Request) {
  const u = await mobileUser(req);
  return u ? json(await exportSubjectData(db, u.id)) : unauthorised();
}
