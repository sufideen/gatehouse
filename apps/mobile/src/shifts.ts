import type { ShiftContext } from "./screens/ActiveShiftScreen";

/** Shape returned by GET /api/mobile/shifts. */
export type ApiShift = {
  id: string; siteId: string; siteName: string; type: "STATIC" | "MOBILE_PATROL"; status: string; startUtc: string; endUtc: string;
  centre: { lat: number; lng: number }; radiusM: number; instructions: string | null;
  checkpoints: { name: string; tagUid: string }[];
  clockIn: { syncUuid: string; clockInUtc: string } | null;
};

/** Pure mapping so it can be unit tested. Tag UIDs stay arbitrary strings (legacy Guardhouse tags). */
export function toShiftContext(s: ApiShift, cfg: { apiUrl: string; controlRoomMobile: string; welfareIntervalMin?: number }): ShiftContext {
  return {
    shiftId: s.id, siteId: s.siteId, siteName: s.siteName, centre: s.centre, radiusM: s.radiusM,
    checkpoints: Object.fromEntries(s.checkpoints.map((c) => [c.tagUid, c.name])),
    welfareIntervalMin: cfg.welfareIntervalMin ?? 60, controlRoomMobile: cfg.controlRoomMobile, apiUrl: cfg.apiUrl,
    clockIn: s.clockIn ? { syncUuid: s.clockIn.syncUuid } : null,
  };
}
