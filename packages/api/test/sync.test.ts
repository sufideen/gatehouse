import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { uuidv7 } from "uuidv7";
import { attendanceLogs, checkpoints, patrolLogs, pointWkt, shifts } from "@gatehouse/db";
import { isWithinSiteGeofence, distanceMeters } from "../src/geofence";
import { applySyncBatch, syncBatch } from "../src/sync";
import { fixture, setupDb, TEST_URL } from "./helpers";

const INSIDE = { lat: 51.5049, lng: -0.0196 };
const OUTSIDE = { lat: 51.5049, lng: -0.0296 }; // ~690m west

describe("sync schema", () => {
  it("rejects non-UUIDv7 idempotency keys and missing selfie", () => {
    const base = { deviceId: "d", guardId: crypto.randomUUID() };
    const rec = { type: "CLOCK_IN", syncUuid: crypto.randomUUID(), deviceUtc: new Date(), shiftId: crypto.randomUUID(), gps: INSIDE, selfieKey: "k" };
    expect(syncBatch.safeParse({ ...base, records: [rec] }).success).toBe(false); // v4
    expect(syncBatch.safeParse({ ...base, records: [{ ...rec, syncUuid: uuidv7(), selfieKey: "" }] }).success).toBe(false);
    expect(syncBatch.safeParse({ ...base, records: [{ ...rec, syncUuid: uuidv7() }] }).success).toBe(true);
  });
  it("haversine agrees with expected distance", () => expect(distanceMeters(INSIDE, OUTSIDE)).toBeGreaterThan(650));
});

describe.skipIf(!TEST_URL)("geofence + sync (db)", () => {
  let ctx: Awaited<ReturnType<typeof setupDb>>;
  beforeAll(async () => { ctx = await setupDb(); });
  afterAll(async () => { await ctx.sql.end(); });

  it("ST_DWithin: inside vs outside the site boundary", async () => {
    const f = await fixture(ctx.db);
    expect(await isWithinSiteGeofence(ctx.db, f.site.id, INSIDE.lat, INSIDE.lng)).toBe(true);
    expect(await isWithinSiteGeofence(ctx.db, f.site.id, OUTSIDE.lat, OUTSIDE.lng)).toBe(false);
  });

  it("clock-in is idempotent, geofenced, and patrol scans keep legacy tag UIDs", async () => {
    const f = await fixture(ctx.db);
    const guard = await f.mk("STATIC_GUARD");
    await ctx.db.update(shifts).set({ guardId: guard.id, status: "ASSIGNED" }).where(eq(shifts.id, f.shift.id));
    await ctx.db.insert(checkpoints).values({ siteId: f.site.id, name: "Gate", externalTagUid: "GH-LEGACY-7", location: pointWkt(INSIDE.lat, INSIDE.lng) });

    const inId = uuidv7(), badId = uuidv7(), scanId = uuidv7();
    const mk = (records: unknown[]) => syncBatch.parse({ deviceId: "d1", guardId: guard.id, records });
    const clockIn = { type: "CLOCK_IN", syncUuid: inId, deviceUtc: new Date(), shiftId: f.shift.id, gps: INSIDE, selfieKey: "selfies/1.jpg" };
    const batch = mk([clockIn, { ...clockIn, syncUuid: badId, gps: OUTSIDE }, { type: "PATROL_SCAN", syncUuid: scanId, deviceUtc: new Date(), shiftId: f.shift.id, tagUid: "GH-LEGACY-7" }]);

    const r1 = await applySyncBatch(ctx.db, batch);
    expect(r1.map((r) => r.status)).toEqual(["APPLIED", "REJECTED", "APPLIED"]);
    expect(r1[1]!.reason).toBe("Outside site geofence");
    const r2 = await applySyncBatch(ctx.db, batch);       // replay after a flaky network
    expect(r2.map((r) => r.status)).toEqual(["DUPLICATE", "REJECTED", "DUPLICATE"]);

    expect(await ctx.db.select().from(attendanceLogs).where(eq(attendanceLogs.shiftId, f.shift.id))).toHaveLength(1);
    const [scan] = await ctx.db.select().from(patrolLogs).where(eq(patrolLogs.shiftId, f.shift.id));
    expect(scan!.checkpointId).not.toBeNull();
  });

  it("patrol_logs rows cannot be updated or deleted", async () => {
    const f = await fixture(ctx.db);
    const guard = await f.mk("STATIC_GUARD");
    await ctx.db.update(shifts).set({ guardId: guard.id }).where(eq(shifts.id, f.shift.id));
    await applySyncBatch(ctx.db, syncBatch.parse({ deviceId: "d", guardId: guard.id, records: [{ type: "PATROL_SCAN", syncUuid: uuidv7(), deviceUtc: new Date(), shiftId: f.shift.id, tagUid: "ANY" }] }));
    await expect(ctx.db.delete(patrolLogs).where(eq(patrolLogs.shiftId, f.shift.id))).rejects.toThrow(/append-only/);
    await expect(ctx.db.update(patrolLogs).set({ scannedTagUid: "x" }).where(eq(patrolLogs.shiftId, f.shift.id))).rejects.toThrow(/append-only/);
  });
});
