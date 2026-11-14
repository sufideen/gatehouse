import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import { attendanceLogs, checkpoints, shifts, sites } from "@gatehouse/db";
import { db } from "@/lib/db";
import { json, mobileUser, unauthorised } from "@/lib/mobile-auth";

export const dynamic = "force-dynamic";

/**
 * The signed-in guard's own upcoming/current shifts, with everything the phone needs to work offline:
 * site centre + radius (geofence), checkpoint tag UIDs, and an open clock-in to resume.
 * Pay and charge rates are deliberately NOT included.
 */
export async function GET(req: Request) {
  const u = await mobileUser(req);
  if (!u) return unauthorised();
  const horizon = new Date(Date.now() - 12 * 3_600_000); // keep night shifts that have just finished until clock-out syncs
  const rows = await db.select({
    id: shifts.id, siteId: shifts.siteId, type: shifts.shiftType, status: shifts.status, startUtc: shifts.startUtc, endUtc: shifts.endUtc,
    siteName: sites.name, radiusM: sites.radiusMeters, instructions: sites.siteInstructions,
    lat: sql<number>`ST_Y(${sites.centre}::geometry)`, lng: sql<number>`ST_X(${sites.centre}::geometry)`,
  }).from(shifts).innerJoin(sites, eq(sites.id, shifts.siteId))
    .where(and(eq(shifts.guardId, u.id), inArray(shifts.status, ["ASSIGNED", "IN_PROGRESS"]), gt(shifts.endUtc, horizon)))
    .orderBy(asc(shifts.startUtc), asc(shifts.id)).limit(10);
  if (!rows.length) return json({ shifts: [] });

  const siteIds = [...new Set(rows.map((r) => r.siteId))], shiftIds = rows.map((r) => r.id);
  const cps = await db.select({ siteId: checkpoints.siteId, name: checkpoints.name, tagUid: checkpoints.externalTagUid }).from(checkpoints).where(inArray(checkpoints.siteId, siteIds));
  const att = await db.select().from(attendanceLogs).where(inArray(attendanceLogs.shiftId, shiftIds));

  return json({
    shifts: rows.map((r) => {
      const a = att.find((x) => x.shiftId === r.id);
      return {
        id: r.id, siteId: r.siteId, siteName: r.siteName, type: r.type, status: r.status, startUtc: r.startUtc, endUtc: r.endUtc,
        centre: { lat: Number(r.lat), lng: Number(r.lng) }, radiusM: r.radiusM, instructions: r.instructions,
        checkpoints: cps.filter((c) => c.siteId === r.siteId).map((c) => ({ name: c.name, tagUid: c.tagUid })),
        clockIn: a && !a.clockOutUtc ? { syncUuid: a.syncUuid, clockInUtc: a.clockInUtc } : null,
      };
    }),
  });
}
