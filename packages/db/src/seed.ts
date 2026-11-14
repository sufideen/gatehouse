import { uuidv7 } from "uuidv7";
import { createDb } from "./client";
import { circlePolygonWkt, pointWkt } from "./geo";
import { writeAudit } from "./audit";
import * as s from "./schema";

const { db, sql } = createDb();

const FIRST = ["Oluwaseun","James","Priya","Daniel","Amira","Connor","Fatima","Liam","Chidi","Sophie","Tomasz","Hannah","Marcus","Aisha","Ben","Ngozi","Callum","Zainab","Ryan","Elena","Kwame","Megan","Imran","Jade","Patrick"];
const LAST = ["Adeyemi","Clarke","Patel","O'Brien","Hassan","Mitchell","Khan","Walsh","Okafor","Turner","Nowak","Evans","Reid","Siddiqui","Foster","Eze","Hughes","Begum","Morgan","Popescu","Mensah","Davies","Ali","Bennett","Murphy"];

const SITES = [
  { name: "Canary Wharf Tower Lobby", address: "1 Canada Square, London", postcode: "E14 5AB", lat: 51.5049, lng: -0.0196 },
  { name: "Shoreditch Retail Park", address: "Bethnal Green Rd, London", postcode: "E1 6GY", lat: 51.5246, lng: -0.0722 },
  { name: "Croydon Distribution Depot", address: "Purley Way, Croydon", postcode: "CR0 4XG", lat: 51.3762, lng: -0.1175 },
  { name: "Southwark Construction Site", address: "Blackfriars Rd, London", postcode: "SE1 8NW", lat: 51.5043, lng: -0.1048 },
  { name: "Westfield Stratford Service Yard", address: "Montfichet Rd, London", postcode: "E20 1EJ", lat: 51.5434, lng: -0.0088 },
];

const day = 86_400_000;
const dateOffset = (days: number) => new Date(Date.now() + days * day);

await db.transaction(async (tx) => {
  const [co] = await tx.insert(s.organisations).values({
    name: "Thames Shield Security Ltd", companyNumber: "09876543", acsReference: "ACS-LON-0042", isSecurityProvider: true,
  }).returning();
  const clients = await tx.insert(s.organisations).values(
    SITES.map((x) => ({ name: `${x.name.split(" ")[0]} Estates Ltd` })),
  ).returning();

  await tx.insert(s.users).values({ organisationId: co!.id, role: "ADMIN", firstName: "Ada", lastName: "Control", email: "admin@thamesshield.example" });
  const [compliance] = await tx.insert(s.users).values({ organisationId: co!.id, role: "COMPLIANCE_ADMIN", firstName: "Colin", lastName: "Compliance", email: "compliance@thamesshield.example" }).returning();
  await tx.insert(s.users).values({ organisationId: co!.id, role: "CONTROL_ROOM", firstName: "Rosa", lastName: "Operator", email: "controlroom@thamesshield.example" });

  const guards = await tx.insert(s.users).values(FIRST.map((f, i) => {
    const expired = i === 0 || i === 1;      // 2 expired SIA licences for tests
    const expiringSoon = i === 2;            // amber badge
    return {
      organisationId: co!.id,
      role: (i >= 20 ? "PATROL_DRIVER" : "STATIC_GUARD") as "PATROL_DRIVER" | "STATIC_GUARD",
      firstName: f, lastName: LAST[i]!,
      email: `${f}.${LAST[i]!}`.toLowerCase().replace(/[^a-z.]/g, "") + "@thamesshield.example",
      mobile: `07700 900${String(100 + i)}`,
      employmentType: (i % 5 === 4 ? "RELIEF_BANK" : "FULL_TIME") as "RELIEF_BANK" | "FULL_TIME",
      siaBadgeNumber: `1234 5678 ${String(1000 + i)}`,
      siaSector: i >= 20 ? "Security Guarding + Vehicle Patrol" : "Security Guarding",
      siaLicenceExpiry: dateOffset(expired ? -30 : expiringSoon ? 14 : 400 + i * 10),
      bs7858VettingStatus: (i === 3 ? "IN_PROGRESS" : "VERIFIED") as "IN_PROGRESS" | "VERIFIED",
      emergencyContactName: `Next of kin ${i + 1}`,
      emergencyContactPhone: `07700 900${String(500 + i)}`,
    };
  })).returning();

  const sites = await tx.insert(s.sites).values(SITES.map((x, i) => ({
    organisationId: co!.id, clientId: clients[i]!.id, name: x.name, address: x.address, postcode: x.postcode,
    centre: pointWkt(x.lat, x.lng), geofence: circlePolygonWkt(x.lat, x.lng, 75), radiusMeters: 75,
    siteInstructions: "Report to reception. Log all visitors. Escalate incidents to control room.",
  }))).returning();

  // Checkpoints: 4 per site, tags deliberately in mixed legacy Guardhouse formats.
  await tx.insert(s.checkpoints).values(sites.flatMap((site, si) =>
    ["Main Entrance", "Loading Bay", "Plant Room", "Rear Fence"].map((name, ci) => ({
      siteId: site.id, name,
      externalTagUid: ci % 2 === 0 ? `GH-${si + 1}-${100 + ci}` : `04:A${si}:${ci}F:2B:7C:80`,
      expectedIntervalMins: 60,
      location: pointWkt(SITES[si]!.lat + ci * 0.0001, SITES[si]!.lng + ci * 0.0001),
    }))));

  // Inductions for compliant guards at their sites; guard 4 deliberately has none.
  const compliantStatic = guards.filter((g, i) => i >= 2 && i !== 3 && i < 20);
  await tx.insert(s.siteInductions).values(sites.flatMap((site) =>
    compliantStatic.slice(0, 8).map((g) => ({ siteId: site.id, guardId: g.id, completedAt: dateOffset(-60) }))));

  // Shifts: next 3 days of 12h static days/nights per site (open), plus 1 mobile patrol route.
  const base = new Date(); base.setUTCHours(6, 0, 0, 0);
  const shiftRows: (typeof s.shifts.$inferInsert)[] = sites.flatMap((site) => [0, 1, 2].flatMap((d) => [0, 12].map((h) => ({
    siteId: site.id, shiftType: "STATIC" as const,
    startUtc: new Date(base.getTime() + d * day + h * 3_600_000),
    endUtc: new Date(base.getTime() + d * day + (h + 12) * 3_600_000),
    payRateGbp: "12.60", chargeRateGbp: "19.50",
  }))));
  shiftRows.push({
    siteId: sites[2]!.id, shiftType: "MOBILE_PATROL" as const,
    startUtc: new Date(base.getTime() + 12 * 3_600_000), endUtc: new Date(base.getTime() + 24 * 3_600_000),
    payRateGbp: "13.40", chargeRateGbp: "21.00",
  });
  await tx.insert(s.shifts).values(shiftRows);

  // ---- 14 days of synthetic history so dashboards/audit views have content ----
  const allCps = await tx.select().from(s.checkpoints);
  for (let d = 1; d <= 14; d++) {
    for (const [si, site] of sites.entries()) {
      const guard = compliantStatic[(d + si) % compliantStatic.length]!;
      const start = new Date(base.getTime() - d * day);
      const [sh] = await tx.insert(s.shifts).values({
        siteId: site.id, guardId: guard.id, shiftType: "STATIC", status: "COMPLETED", startUtc: start,
        endUtc: new Date(start.getTime() + 12 * 3_600_000), payRateGbp: "12.60", chargeRateGbp: "19.50",
      }).returning();
      await tx.insert(s.attendanceLogs).values({
        shiftId: sh!.id, syncUuid: uuidv7(), clockInUtc: new Date(start.getTime() + 2 * 60_000), clockInGps: pointWkt(SITES[si]!.lat, SITES[si]!.lng),
        clockInSelfieS3Key: `selfies/synthetic-${si}-${d}.jpg`, clockOutUtc: new Date(start.getTime() + 12 * 3_600_000), clockOutGps: pointWkt(SITES[si]!.lat, SITES[si]!.lng), isOfflineSynced: d % 3 === 0,
      });
      const cps = allCps.filter((c) => c.siteId === site.id);
      await tx.insert(s.patrolLogs).values(Array.from({ length: 8 }, (_, k) => ({
        shiftId: sh!.id, checkpointId: cps[k % cps.length]!.id, scannedTagUid: cps[k % cps.length]!.externalTagUid,
        scannedUtc: new Date(start.getTime() + (k + 1) * 85 * 60_000), gpsPoint: pointWkt(SITES[si]!.lat, SITES[si]!.lng), syncUuid: uuidv7(),
      })));
      await tx.insert(s.welfareChecks).values(Array.from({ length: 6 }, (_, k) => ({
        shiftId: sh!.id, syncUuid: uuidv7(), dueUtc: new Date(start.getTime() + (k + 1) * 2 * 3_600_000),
        confirmedUtc: new Date(start.getTime() + (k + 1) * 2 * 3_600_000 + 60_000), status: "OK" as const,
      })));
      if ((d + si) % 4 === 0) await tx.insert(s.incidentReports).values({
        siteId: site.id, guardId: guard.id, syncUuid: uuidv7(), severity: "LOW", category: "Trespass",
        transcriptText: "Synthetic incident: unauthorised person asked to leave the loading bay.", clientVisible: true, reportedUtc: new Date(start.getTime() + 5 * 3_600_000),
      });
    }
  }

  await writeAudit(tx, { actorId: compliance!.id, action: "SEED", entityType: "organisation", entityId: co!.id, newValues: { guards: guards.length, sites: sites.length, dataOrigin: "SYNTHETIC" } });
});

console.log("seeded: 1 company, 25 guards (2 expired SIA), 5 sites, 1 mobile patrol route");
await sql.end();
