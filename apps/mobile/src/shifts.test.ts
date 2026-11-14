import { describe, expect, it } from "vitest";
import { toShiftContext, type ApiShift } from "./shifts";

const shift: ApiShift = {
  id: "s1", siteId: "site1", siteName: "Depot", type: "STATIC", status: "ASSIGNED", startUtc: "2026-11-15T06:00:00Z", endUtc: "2026-11-15T18:00:00Z",
  centre: { lat: 51.5, lng: -0.02 }, radiusM: 75, instructions: null,
  checkpoints: [{ name: "Gate", tagUid: "GH-0001" }, { name: "Plant", tagUid: "04:A2:2B:7C:80:11" }], clockIn: null,
};
const cfg = { apiUrl: "https://x.example", controlRoomMobile: "" };

describe("toShiftContext", () => {
  it("maps arbitrary legacy tag UIDs to checkpoint names for offline matching", () => {
    expect(toShiftContext(shift, cfg).checkpoints).toEqual({ "GH-0001": "Gate", "04:A2:2B:7C:80:11": "Plant" });
  });
  it("carries geofence centre and radius", () => expect(toShiftContext(shift, cfg)).toMatchObject({ centre: { lat: 51.5, lng: -0.02 }, radiusM: 75 }));
  it("resumes an open clock-in so clock-out references the original key", () => {
    expect(toShiftContext({ ...shift, status: "IN_PROGRESS", clockIn: { syncUuid: "k1", clockInUtc: "2026-11-15T06:02:00Z" } }, cfg).clockIn).toEqual({ syncUuid: "k1" });
    expect(toShiftContext(shift, cfg).clockIn).toBeNull();
  });
});
