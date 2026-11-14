import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { checkpoints, immutableAuditLogs, organisations, sites, users } from "@gatehouse/db";
import { commitGuardhouseImport, parseUkDate, previewGuardsCsv, previewSitesCsv } from "../src/import/guardhouse";
import { setupDb, TEST_URL } from "./helpers";

const guardsCsv = `First Name,Last Name,Email,Mobile,SIA Licence Number,Licence Expiry,Employment Type
Ada,Lovelace,ada@x.example,07700900001,1111 2222 3333 4444,01/01/2020,Full-Time
Bob,Bank,bob@x.example,07700900002,5555 6666 7777 8888,31/12/2030,Relief Bank
Bob,Dup,BOB@x.example,07700900003,9999,31/12/2030,Full-Time
`;
const sitesCsv = `Site Name,Address,Postcode,Latitude,Longitude,Checkpoint Name,Tag UID
Depot,1 Yard Rd,e14 5ab,51.5049,-0.0196,Gate,GH-0001
Depot,1 Yard Rd,e14 5ab,51.5049,-0.0196,Gate again,GH-0001
Depot,1 Yard Rd,e14 5ab,51.5049,-0.0196,Plant,04:A2:2B:7C:80:11
No Coords,2 Lane,SW1A 1AA,,,Door,X1
`;

describe("Guardhouse importer (pure)", () => {
  it("parses UK and ISO dates, rejecting impossible ones", () => {
    expect(parseUkDate("31/12/2030")?.toISOString()).toBe("2030-12-31T00:00:00.000Z");
    expect(parseUkDate("2030-12-31")?.toISOString()).toBe("2030-12-31T00:00:00.000Z");
    expect(parseUkDate("31/02/2030")).toBeNull();
  });
  it("flags expired SIA badges and duplicate emails in the preview", () => {
    const g = previewGuardsCsv(guardsCsv, new Date("2026-11-14"));
    expect(g[0]!.issues.map((i) => i.message)).toContain("SIA licence EXPIRED: guard will be blocked from assignment");
    expect(g[1]!.employmentType).toBe("RELIEF_BANK");
    expect(g[2]!.issues).toContainEqual({ level: "ERROR", message: "Duplicate email in file" });
  });
  it("keeps arbitrary tag strings, skips duplicate UIDs and flags missing coordinates", () => {
    const s = previewSitesCsv(sitesCsv);
    expect(s[0]!.checkpoints.map((c) => c.externalTagUid)).toEqual(["GH-0001", "04:A2:2B:7C:80:11"]);
    expect(s[0]!.issues.some((i) => i.message.includes("Duplicate tag UID"))).toBe(true);
    expect(s[1]!.issues[0]!.level).toBe("ERROR");
  });
});

describe.skipIf(!TEST_URL)("commitGuardhouseImport (db)", () => {
  let ctx: Awaited<ReturnType<typeof setupDb>>;
  beforeAll(async () => { ctx = await setupDb(); });
  afterAll(async () => { await ctx.sql.end(); });

  it("imports valid rows transactionally, preserves tag UIDs and audits the bulk event", async () => {
    const [org] = await ctx.db.insert(organisations).values({ name: "Import Co" }).returning();
    const res = await commitGuardhouseImport(ctx.db, {
      organisationId: org!.id, actorId: null, guards: previewGuardsCsv(guardsCsv), sites: previewSitesCsv(sitesCsv), mode: { dataOrigin: "SYNTHETIC" },
    });
    expect(res).toMatchObject({ guardsCreated: 2, guardsSkipped: 1, sitesCreated: 1, checkpointsCreated: 2 });
    const [site] = await ctx.db.select().from(sites).where(eq(sites.organisationId, org!.id));
    const cps = await ctx.db.select().from(checkpoints).where(eq(checkpoints.siteId, site!.id));
    expect(cps.map((c) => c.externalTagUid).sort()).toEqual(["04:A2:2B:7C:80:11", "GH-0001"]);
    const imported = await ctx.db.select().from(users).where(eq(users.organisationId, org!.id));
    expect(imported.every((u) => u.bs7858VettingStatus === "PENDING")).toBe(true);
    const [a] = await ctx.db.select().from(immutableAuditLogs).where(eq(immutableAuditLogs.entityId, org!.id));
    expect(a).toMatchObject({ action: "BULK_IMPORT_GUARDHOUSE" });
  });
});
