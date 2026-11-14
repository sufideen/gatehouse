import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb, organisations, sites, users, shifts, pointWkt, circlePolygonWkt, siteInductions } from "@gatehouse/db";

export const TEST_URL = process.env.TEST_DATABASE_URL;

export async function setupDb() {
  const { db, sql } = createDb(TEST_URL);
  await migrate(db, { migrationsFolder: new URL("../../db/drizzle", import.meta.url).pathname });
  return { db, sql };
}

const rnd = () => Math.random().toString(36).slice(2, 8);
const DAY = 86_400_000;

/** Fresh tenant with a site at Canary Wharf, a compliance admin and an assignable shift. */
export async function fixture(db: ReturnType<typeof createDb>["db"]) {
  const [org] = await db.insert(organisations).values({ name: `T-${rnd()}`, isSecurityProvider: true }).returning();
  const [site] = await db.insert(sites).values({
    organisationId: org!.id, name: "Test Site", address: "1 Test St", postcode: "E14 5AB",
    centre: pointWkt(51.5049, -0.0196), geofence: circlePolygonWkt(51.5049, -0.0196, 75), radiusMeters: 75,
  }).returning();
  const mk = (role: "ADMIN" | "COMPLIANCE_ADMIN" | "STATIC_GUARD", over: Partial<typeof users.$inferInsert> = {}) =>
    db.insert(users).values({
      organisationId: org!.id, role, firstName: "A", lastName: "B", email: `${rnd()}@t.example`,
      siaLicenceExpiry: new Date(Date.now() + 200 * DAY), bs7858VettingStatus: "VERIFIED", ...over,
    }).returning().then((r) => r[0]!);
  const start = new Date(Date.now() + 2 * DAY);
  const [shift] = await db.insert(shifts).values({
    siteId: site!.id, shiftType: "STATIC", startUtc: start, endUtc: new Date(start.getTime() + 12 * 3_600_000),
    payRateGbp: "12.60", chargeRateGbp: "19.50",
  }).returning();
  const induct = (guardId: string) => db.insert(siteInductions).values({ siteId: site!.id, guardId, completedAt: new Date() });
  return { org: org!, site: site!, shift: shift!, mk, induct };
}
