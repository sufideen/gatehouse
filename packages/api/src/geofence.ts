import { sql } from "drizzle-orm";
import type { Db } from "@gatehouse/db";

/** Authoritative check: PostGIS ST_DWithin(site centre, point, radius metres). */
export async function isWithinSiteGeofence(db: Pick<Db, "execute">, siteId: string, lat: number, lng: number): Promise<boolean> {
  const rows = await db.execute<{ ok: boolean }>(sql`
    SELECT ST_DWithin(centre, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography, radius_meters) AS ok
    FROM sites WHERE id = ${siteId}`);
  return rows[0]?.ok === true;
}

/** Haversine distance in metres; used for UI badges / offline mirror of the server rule. */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_008.8, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
