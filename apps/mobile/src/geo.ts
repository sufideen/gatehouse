export type LatLng = { lat: number; lng: number };
/** Haversine, mirrors packages/api geofence helper. Server ST_DWithin remains authoritative. */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const R = 6_371_008.8, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
