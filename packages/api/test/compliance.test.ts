import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { immutableAuditLogs, shifts } from "@gatehouse/db";
import { assignGuardToShift, ComplianceError, complianceBadge, evaluateCompliance } from "../src/compliance";
import { fixture, setupDb, TEST_URL } from "./helpers";

const shift = { startUtc: new Date("2026-12-01T06:00:00Z"), endUtc: new Date("2026-12-01T18:00:00Z") };
const ok = { siaLicenceExpiry: new Date("2027-06-01"), bs7858VettingStatus: "VERIFIED", siteInductionCompleted: true };

describe("evaluateCompliance (pure)", () => {
  it("passes a fully compliant guard", () => expect(evaluateCompliance(ok, shift)).toEqual([]));
  it("rejects an expired SIA licence", () =>
    expect(evaluateCompliance({ ...ok, siaLicenceExpiry: new Date("2026-11-30") }, shift).map((v) => v.code)).toEqual(["SIA_EXPIRED"]));
  it("accepts a licence expiring on the shift day but blocks one lapsing before shift end", () => {
    expect(evaluateCompliance({ ...ok, siaLicenceExpiry: new Date("2026-12-01") }, shift)).toEqual([]);
    expect(evaluateCompliance({ ...ok, siaLicenceExpiry: new Date("2026-12-01") }, { ...shift, endUtc: new Date("2026-12-02T06:00:00Z") }).map((v) => v.code)).toEqual(["SIA_EXPIRED"]);
  });
  it("rejects missing licence, unverified vetting and missing induction together", () =>
    expect(evaluateCompliance({ siaLicenceExpiry: null, bs7858VettingStatus: "IN_PROGRESS", siteInductionCompleted: false }, shift).map((v) => v.code))
      .toEqual(["SIA_MISSING", "VETTING_NOT_VERIFIED", "SITE_INDUCTION_MISSING"]));
  it("badges green / amber / red", () => {
    const now = new Date("2026-11-14");
    expect(complianceBadge(ok, shift.startUtc, now)).toBe("GREEN");
    expect(complianceBadge({ ...ok, siaLicenceExpiry: new Date("2026-12-01") }, shift.startUtc, now)).toBe("AMBER");
    expect(complianceBadge({ ...ok, bs7858VettingStatus: "PENDING" }, shift.startUtc, now)).toBe("RED");
  });
});

describe.skipIf(!TEST_URL)("assignGuardToShift (db)", () => {
  let ctx: Awaited<ReturnType<typeof setupDb>>;
  beforeAll(async () => { ctx = await setupDb(); });
  afterAll(async () => { await ctx.sql.end(); });

  const audits = (shiftId: string) => ctx.db.select().from(immutableAuditLogs).where(eq(immutableAuditLogs.entityId, shiftId));

  it("assigns a compliant guard and audits it", async () => {
    const f = await fixture(ctx.db);
    const admin = await f.mk("ADMIN"), guard = await f.mk("STATIC_GUARD");
    await f.induct(guard.id);
    const r = await assignGuardToShift(ctx.db, { shiftId: f.shift.id, guardId: guard.id, actorId: admin.id });
    expect(r.overridden).toBe(false);
    expect((await audits(f.shift.id)).map((a) => a.action)).toEqual(["ASSIGN_GUARD"]);
  });

  it("blocks an expired-SIA guard, even for plain ADMIN with a reason, and audits the refusal", async () => {
    const f = await fixture(ctx.db);
    const admin = await f.mk("ADMIN");
    const guard = await f.mk("STATIC_GUARD", { siaLicenceExpiry: new Date(Date.now() - 30 * 86_400_000) });
    await f.induct(guard.id);
    await expect(assignGuardToShift(ctx.db, { shiftId: f.shift.id, guardId: guard.id, actorId: admin.id, overrideReason: "urgent" }))
      .rejects.toMatchObject({ code: "OVERRIDE_FORBIDDEN" });
    const [s] = await ctx.db.select().from(shifts).where(eq(shifts.id, f.shift.id));
    expect(s!.guardId).toBeNull();
    expect((await audits(f.shift.id)).map((a) => a.action)).toEqual(["ASSIGN_BLOCKED"]);
  });

  it("requires a non-empty reason for COMPLIANCE_ADMIN overrides", async () => {
    const f = await fixture(ctx.db);
    const ca = await f.mk("COMPLIANCE_ADMIN");
    const guard = await f.mk("STATIC_GUARD", { bs7858VettingStatus: "IN_PROGRESS" });
    await f.induct(guard.id);
    const err = await assignGuardToShift(ctx.db, { shiftId: f.shift.id, guardId: guard.id, actorId: ca.id, overrideReason: "   " }).catch((e) => e);
    expect(err).toBeInstanceOf(ComplianceError);
    expect(err.code).toBe("OVERRIDE_REASON_REQUIRED");
  });

  it("allows COMPLIANCE_ADMIN override with reason and writes it to the audit log", async () => {
    const f = await fixture(ctx.db);
    const ca = await f.mk("COMPLIANCE_ADMIN");
    const guard = await f.mk("STATIC_GUARD", { siaLicenceExpiry: new Date(Date.now() - 86_400_000 * 3) });
    const r = await assignGuardToShift(ctx.db, { shiftId: f.shift.id, guardId: guard.id, actorId: ca.id, overrideReason: "Renewal confirmed by SIA portal, badge in post" });
    expect(r.overridden).toBe(true);
    const [a] = await audits(f.shift.id);
    expect(a).toMatchObject({ action: "COMPLIANCE_OVERRIDE_ASSIGN", actorId: ca.id });
    expect(JSON.stringify(a!.newValuesJson)).toContain("badge in post");
    expect(JSON.stringify(a!.newValuesJson)).toContain("SIA_EXPIRED");
  });
});
