import { customType } from "drizzle-orm/pg-core";

/** PostGIS GEOGRAPHY(Point, 4326). Written as EWKT, read back as hex EWKB string. */
export const geographyPoint = customType<{ data: string; driverData: string }>({
  dataType: () => "geography(Point, 4326)",
});

/** PostGIS GEOGRAPHY(Polygon, 4326). */
export const geographyPolygon = customType<{ data: string; driverData: string }>({
  dataType: () => "geography(Polygon, 4326)",
});

/** EWKT helper: lng/lat order (PostGIS x/y). */
export const pointWkt = (lat: number, lng: number) => `SRID=4326;POINT(${lng} ${lat})`;

/** Approximate a circular geofence polygon (default 75m) as EWKT, 32 segments. */
export function circlePolygonWkt(lat: number, lng: number, radiusM = 75, segments = 32): string {
  const earth = 6_371_000;
  const pts: string[] = [];
  for (let i = 0; i <= segments; i++) {
    const brg = ((i % segments) / segments) * 2 * Math.PI;
    const dLat = (radiusM * Math.cos(brg)) / earth;
    const dLng = (radiusM * Math.sin(brg)) / (earth * Math.cos((lat * Math.PI) / 180));
    pts.push(`${(lng + (dLng * 180) / Math.PI).toFixed(7)} ${(lat + (dLat * 180) / Math.PI).toFixed(7)}`);
  }
  return `SRID=4326;POLYGON((${pts.join(",")}))`;
}
