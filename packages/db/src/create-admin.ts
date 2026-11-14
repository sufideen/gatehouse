import { eq } from "drizzle-orm";
import { createDb } from "./client";
import { writeAudit } from "./audit";
import { hashPassword } from "./password";
import { organisations, users } from "./schema";

/**
 * Production bootstrap (there is no public sign-up and the demo seed must never run in production).
 *   ORG_NAME="Thames Shield Security Ltd" ADMIN_EMAIL=you@company.co.uk ADMIN_FIRST=Ada ADMIN_LAST=Lovelace ADMIN_PASSWORD='...' pnpm --filter @gatehouse/db create-admin
 * Creates the security-provider organisation (if none) and a COMPLIANCE_ADMIN. MFA enrolment is forced at first sign-in.
 */
const env = (k: string) => process.env[k]?.trim() ?? "";
const [orgName, email, first, last, password] = [env("ORG_NAME"), env("ADMIN_EMAIL").toLowerCase(), env("ADMIN_FIRST"), env("ADMIN_LAST"), process.env.ADMIN_PASSWORD ?? ""];
if (!orgName || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !first || !last) throw new Error("Set ORG_NAME, ADMIN_EMAIL, ADMIN_FIRST, ADMIN_LAST");
if (password.length < 12) throw new Error("ADMIN_PASSWORD must be at least 12 characters");

const { db, sql } = createDb();
await db.transaction(async (tx) => {
  let [org] = await tx.select().from(organisations).where(eq(organisations.isSecurityProvider, true));
  org ??= (await tx.insert(organisations).values({ name: orgName, isSecurityProvider: true }).returning())[0]!;
  const [dupe] = await tx.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (dupe) throw new Error("A user with that email already exists");
  const [u] = await tx.insert(users).values({
    organisationId: org.id, role: "COMPLIANCE_ADMIN", firstName: first, lastName: last, email,
    passwordHash: await hashPassword(password), dataOrigin: "PILOT_CONSENTED", // a real person, not synthetic
  }).returning({ id: users.id });
  await writeAudit(tx, { actorId: u!.id, action: "BOOTSTRAP_ADMIN", entityType: "user", entityId: u!.id });
  console.log(`created COMPLIANCE_ADMIN ${email}. They must set up MFA at first sign-in.`);
});
await sql.end();
