import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { consents, hashPassword, immutableAuditLogs, invites, users, verifyPassword } from "@gatehouse/db";
import { createRateLimiter, signSession, verifySession } from "../src/auth";
import { createInvite, findOpenInvite, joinWithInvite } from "../src/pilot";
import { anonymiseUser } from "../src/privacy";
import { fixture, setupDb, TEST_URL } from "./helpers";

describe("passwords", () => {
  it("verifies the right password and rejects wrong, null and malformed hashes", async () => {
    const h = await hashPassword("correct horse battery");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse battery", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
    expect(await verifyPassword("anything", null)).toBe(false);
    expect(await verifyPassword("anything", "garbage")).toBe(false);
  });
  it("salts: same password hashes differently", async () => expect(await hashPassword("same-password-1")).not.toBe(await hashPassword("same-password-1")));
});

describe("sessions", () => {
  const secret = "test-secret-test-secret-test-secret";
  it("round-trips and rejects tampering, wrong secret and expiry", () => {
    const t = signSession({ uid: "u1", exp: Date.now() + 60_000 }, secret);
    expect(verifySession(t, secret)?.uid).toBe("u1");
    expect(verifySession(t, "other-secret-other-secret-other")).toBeNull();
    const [body, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ uid: "admin", exp: Date.now() + 60_000 })).toString("base64url");
    expect(verifySession(`${forged}.${sig}`, secret)).toBeNull();
    expect(verifySession(`${body}.`, secret)).toBeNull();
    expect(verifySession(t, secret, Date.now() + 120_000)).toBeNull();
    expect(verifySession(undefined, secret)).toBeNull();
  });
  it("rate limiter blocks after max attempts within the window", () => {
    const rl = createRateLimiter(3, 1000);
    expect([1, 2, 3, 4].map(() => rl.allow("a", 0))).toEqual([true, true, true, false]);
    expect(rl.allow("b", 0)).toBe(true);
    expect(rl.allow("a", 2000)).toBe(true);
  });
});

describe.skipIf(!TEST_URL)("pilot invites (db)", () => {
  let ctx: Awaited<ReturnType<typeof setupDb>>;
  beforeAll(async () => { ctx = await setupDb(); });
  afterAll(async () => { await ctx.sql.end(); delete process.env.ALLOW_PILOT_DATA; });

  const join = (token: string, over: Record<string, unknown> = {}) => ({
    token, firstName: "Pat", lastName: "Pilot", email: `pat${Math.random().toString(36).slice(2, 7)}@pilotco.example`, password: "a-long-password-1",
    scopes: ["IDENTITY"] as ("IDENTITY" | "CONTACT" | "SIA_DETAILS")[], policyVersion: "pilot-v1", mobile: "07700900111", siaBadgeNumber: "9999", ...over,
  });

  it("stores only a hash of the token and no personal data on the invite", async () => {
    const f = await fixture(ctx.db); const admin = await f.mk("ADMIN");
    const { token, invite } = await createInvite(ctx.db, { organisationId: f.org.id, role: "STATIC_GUARD", label: "Guard A", createdBy: admin.id });
    expect(JSON.stringify(invite)).not.toContain(token);
    expect(await findOpenInvite(ctx.db, token)).not.toBeNull();
    expect(await findOpenInvite(ctx.db, "nope")).toBeNull();
  });

  it("refuses to join outside the pilot deployment", async () => {
    const f = await fixture(ctx.db); const admin = await f.mk("ADMIN");
    const { token } = await createInvite(ctx.db, { organisationId: f.org.id, role: "STATIC_GUARD", label: "x", createdBy: admin.id });
    delete process.env.ALLOW_PILOT_DATA;
    await expect(joinWithInvite(ctx.db, join(token))).rejects.toThrow(/pilot deployment/);
  });

  it("joins with minimal consented fields, a 30-day clock, a consent row; token is single-use", async () => {
    process.env.ALLOW_PILOT_DATA = "true";
    const f = await fixture(ctx.db); const admin = await f.mk("ADMIN");
    const { token } = await createInvite(ctx.db, { organisationId: f.org.id, role: "STATIC_GUARD", label: "x", createdBy: admin.id });
    const { userId } = await joinWithInvite(ctx.db, join(token));
    const [u] = await ctx.db.select().from(users).where(eq(users.id, userId));
    expect(u).toMatchObject({ mobile: null, siaBadgeNumber: null, dataOrigin: "PILOT_CONSENTED", role: "STATIC_GUARD" });
    expect(await verifyPassword("a-long-password-1", u!.passwordHash)).toBe(true);
    expect(u!.passwordHash).not.toContain("a-long-password");
    expect((u!.retentionExpiresAt!.getTime() - Date.now()) / 86_400_000).toBeGreaterThan(29.9);
    expect(await ctx.db.select().from(consents).where(eq(consents.userId, userId))).toHaveLength(1);
    const audit = await ctx.db.select().from(immutableAuditLogs).where(eq(immutableAuditLogs.entityId, userId));
    expect(audit.map((a) => a.action)).toEqual(["PILOT_JOINED"]); // carries scopes + policy version
    await expect(joinWithInvite(ctx.db, join(token))).rejects.toThrow(/invalid, used or expired/);
  });

  it("stores optional fields only when their scope is granted", async () => {
    process.env.ALLOW_PILOT_DATA = "true";
    const f = await fixture(ctx.db); const admin = await f.mk("ADMIN");
    const { token } = await createInvite(ctx.db, { organisationId: f.org.id, role: "PATROL_DRIVER", label: "x", createdBy: admin.id });
    const { userId } = await joinWithInvite(ctx.db, join(token, { scopes: ["IDENTITY", "CONTACT"] }));
    const [u] = await ctx.db.select().from(users).where(eq(users.id, userId));
    expect(u).toMatchObject({ mobile: "07700900111", siaBadgeNumber: null });
  });

  it("rejects missing IDENTITY consent, weak passwords and expired invites", async () => {
    process.env.ALLOW_PILOT_DATA = "true";
    const f = await fixture(ctx.db); const admin = await f.mk("ADMIN");
    const { token } = await createInvite(ctx.db, { organisationId: f.org.id, role: "STATIC_GUARD", label: "x", createdBy: admin.id });
    await expect(joinWithInvite(ctx.db, join(token, { scopes: ["CONTACT"] }))).rejects.toThrow(/IDENTITY/);
    await expect(joinWithInvite(ctx.db, join(token, { password: "short" }))).rejects.toThrow(/at least 12/);
    await ctx.db.update(invites).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(invites.organisationId, f.org.id));
    await expect(joinWithInvite(ctx.db, join(token))).rejects.toThrow(/invalid, used or expired/);
  });

  it("anonymising removes the ability to log in", async () => {
    process.env.ALLOW_PILOT_DATA = "true";
    const f = await fixture(ctx.db); const admin = await f.mk("ADMIN");
    const { token } = await createInvite(ctx.db, { organisationId: f.org.id, role: "STATIC_GUARD", label: "x", createdBy: admin.id });
    const { userId } = await joinWithInvite(ctx.db, join(token));
    await anonymiseUser(ctx.db, { userId, actorId: null, reason: "test" });
    const [u] = await ctx.db.select().from(users).where(eq(users.id, userId));
    expect(u!.passwordHash).toBeNull();
  });
});
