import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { uuidv7 } from "uuidv7";
import { attendanceLogs, consents, immutableAuditLogs, incidentReports, shifts, users } from "@gatehouse/db";
import { commitGuardhouseImport, previewGuardsCsv } from "../src/import/guardhouse";
import { anonymiseUser, exportSubjectData, isReservedEmail, PILOT_RETENTION_DAYS, recordConsent, runRetention, withdrawConsent } from "../src/privacy";
import { fixture, setupDb, TEST_URL } from "./helpers";

describe("PII guard", () => {
  it("retention is 30 days", () => expect(PILOT_RETENTION_DAYS).toBe(30));
  it("recognises reserved domains only", () => {
    expect(isReservedEmail("a@thamesshield.example")).toBe(true);
    expect(isReservedEmail("a@x.invalid")).toBe(true);
    expect(isReservedEmail("someone@gmail.com")).toBe(false);
    expect(isReservedEmail("someone@securityfirm.co.uk")).toBe(false);
  });

  it("seed and test fixtures contain no real-looking emails or UK mobiles", () => {
    const root = join(__dirname, "..", "..");
    const files: string[] = [join(root, "db/src/seed.ts")];
    const walk = (d: string) => readdirSync(d).forEach((f) => { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") && files.push(p); });
    walk(join(root, "api/test"));
    // This file intentionally holds fake "real-looking" values to test the importer gates; every other file must be clean.
    files.splice(0, files.length, ...files.filter((f) => !f.endsWith("privacy.test.ts")));
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      for (const m of text.matchAll(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g)) {
        if (/^(import|@types|@gatehouse|@react|@testing)/.test(m[0])) continue;
        expect(isReservedEmail(m[0]) || m[0].includes("anonymised.invalid"), `${f}: ${m[0]}`).toBe(true);
      }
      for (const m of text.matchAll(/(?:\+44|\b0)\s?7\d{3}\s?\d{3}\s?\d{3}\b/g)) {
        expect(/^(?:\+44|0)\s?7700\s?900/.test(m[0]), `${f}: ${m[0]}`).toBe(true); // Ofcom drama range only
      }
    }
  });
});

describe.skipIf(!TEST_URL)("pilot privacy (db)", () => {
  let ctx: Awaited<ReturnType<typeof setupDb>>;
  beforeAll(async () => { ctx = await setupDb(); });
  afterAll(async () => { await ctx.sql.end(); });

  const csv = `First Name,Last Name,Email,Mobile,SIA Licence Number,Licence Expiry,Employment Type
Real,Person,real.person@securityfirm.co.uk,07911123456,1111 2222 3333 4444,31/12/2030,Full-Time
No,Consent,no.consent@securityfirm.co.uk,07911123457,5555,31/12/2030,Full-Time
Fake,Guard,fake@thamesshield.example,07700900123,9999,31/12/2030,Full-Time
`;

  it("synthetic import rejects real-looking emails", async () => {
    const f = await fixture(ctx.db);
    const r = await commitGuardhouseImport(ctx.db, { organisationId: f.org.id, actorId: null, guards: previewGuardsCsv(csv), mode: { dataOrigin: "SYNTHETIC" } });
    expect(r).toMatchObject({ guardsCreated: 1, guardsSkippedNotSynthetic: 2 });
  });

  it("pilot import is blocked outside a pilot database", async () => {
    const f = await fixture(ctx.db);
    delete process.env.ALLOW_PILOT_DATA;
    await expect(commitGuardhouseImport(ctx.db, { organisationId: f.org.id, actorId: null, guards: previewGuardsCsv(csv), mode: { dataOrigin: "PILOT_CONSENTED", consents: {} } }))
      .rejects.toThrow(/pilot database/);
  });

  it("pilot import takes only consented guards and only the consented fields, with a 30-day expiry", async () => {
    const f = await fixture(ctx.db);
    process.env.ALLOW_PILOT_DATA = "true";
    try {
      const r = await commitGuardhouseImport(ctx.db, {
        organisationId: f.org.id, actorId: null, guards: previewGuardsCsv(csv),
        mode: { dataOrigin: "PILOT_CONSENTED", consents: { "real.person@securityfirm.co.uk": { scopes: ["IDENTITY"], policyVersion: "v1" } } },
      });
      expect(r).toMatchObject({ guardsCreated: 1, guardsSkippedNoConsent: 2 });
      const [u] = await ctx.db.select().from(users).where(eq(users.email, "real.person@securityfirm.co.uk"));
      expect(u).toMatchObject({ mobile: null, siaBadgeNumber: null, siaLicenceExpiry: null, dataOrigin: "PILOT_CONSENTED" });
      const days = (u!.retentionExpiresAt!.getTime() - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(29.9); expect(days).toBeLessThanOrEqual(30);
      expect(await ctx.db.select().from(consents).where(eq(consents.userId, u!.id))).toHaveLength(1);
    } finally { delete process.env.ALLOW_PILOT_DATA; }
  });

  it("requires IDENTITY scope", async () => {
    const f = await fixture(ctx.db); const g = await f.mk("STATIC_GUARD");
    await expect(recordConsent(ctx.db, { userId: g.id, scopes: ["CONTACT"], policyVersion: "v1", recordedBy: null })).rejects.toThrow(/IDENTITY/);
  });

  async function pilotGuardWithData() {
    const f = await fixture(ctx.db);
    const g = await f.mk("STATIC_GUARD", { mobile: "07700900555", emergencyContactName: "Next Kin", siaBadgeNumber: "1234" });
    await recordConsent(ctx.db, { userId: g.id, scopes: ["IDENTITY", "CONTACT", "SIA_DETAILS"], policyVersion: "v1", recordedBy: null });
    await ctx.db.update(shifts).set({ guardId: g.id }).where(eq(shifts.id, f.shift.id));
    await ctx.db.insert(attendanceLogs).values({ shiftId: f.shift.id, syncUuid: uuidv7(), clockInUtc: new Date(), clockInGps: "SRID=4326;POINT(-0.0196 51.5049)", clockInSelfieS3Key: "selfies/real.jpg" });
    await ctx.db.insert(incidentReports).values({ siteId: f.site.id, guardId: g.id, severity: "LOW", category: "Other", transcriptText: "Mentioned John Smith at 12 High St", mediaKeysJson: ["incidents/a.jpg"] });
    return { f, g };
  }

  it("anonymises a user: personal data and media gone, audit log intact and PII-free", async () => {
    const { g } = await pilotGuardWithData();
    const res = await anonymiseUser(ctx.db, { userId: g.id, actorId: null, reason: "ERASURE_REQUEST" });
    expect(res.s3KeysToDelete.sort()).toEqual(["incidents/a.jpg", "selfies/real.jpg"]);
    const [u] = await ctx.db.select().from(users).where(eq(users.id, g.id));
    expect(u).toMatchObject({ firstName: "Anonymised", mobile: null, siaBadgeNumber: null, emergencyContactName: null });
    expect(u!.anonymisedAt).not.toBeNull();
    const [inc] = await ctx.db.select().from(incidentReports).where(eq(incidentReports.guardId, g.id));
    expect(inc).toMatchObject({ transcriptText: null, mediaKeysJson: [] });
    const audit = await ctx.db.select().from(immutableAuditLogs).where(eq(immutableAuditLogs.entityId, g.id));
    expect(audit.map((a) => a.action)).toContain("USER_ANONYMISED");
    expect(JSON.stringify(audit)).not.toContain("07700900555");
    expect((await anonymiseUser(ctx.db, { userId: g.id, actorId: null, reason: "again" })).anonymised).toBe(false); // idempotent
  });

  it("retention anonymises only pilot users past 30 days", async () => {
    const a = await pilotGuardWithData(), b = await pilotGuardWithData();
    const in31 = new Date(Date.now() + 31 * 86_400_000);
    await ctx.db.update(users).set({ retentionExpiresAt: new Date(Date.now() - 1000) }).where(eq(users.id, a.g.id));
    const r = await runRetention(ctx.db, new Date());
    expect(r.anonymisedUserIds).toContain(a.g.id);
    expect(r.anonymisedUserIds).not.toContain(b.g.id);
    expect((await runRetention(ctx.db, in31)).anonymisedUserIds).toContain(b.g.id);
  });

  it("partial withdrawal nulls only those fields; withdrawing IDENTITY anonymises", async () => {
    const { g } = await pilotGuardWithData();
    await withdrawConsent(ctx.db, { userId: g.id, scopes: ["CONTACT", "SIA_DETAILS"], actorId: null });
    let [u] = await ctx.db.select().from(users).where(eq(users.id, g.id));
    expect(u).toMatchObject({ firstName: "A", mobile: null, siaBadgeNumber: null }); expect(u!.anonymisedAt).toBeNull();
    const out = await withdrawConsent(ctx.db, { userId: g.id, scopes: ["IDENTITY"], actorId: null });
    expect(out.anonymised).toBe(true);
    [u] = await ctx.db.select().from(users).where(eq(users.id, g.id));
    expect(u!.firstName).toBe("Anonymised");
  });

  it("exports a subject's data", async () => {
    const { g } = await pilotGuardWithData();
    const x = await exportSubjectData(ctx.db, g.id);
    expect(x.user.id).toBe(g.id);
    expect(x.attendance).toHaveLength(1); expect(x.incidents).toHaveLength(1); expect(x.consents).toHaveLength(1);
  });
});
