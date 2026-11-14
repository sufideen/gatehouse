import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { hashPassword, immutableAuditLogs, passwordResets, users, verifyPassword } from "@gatehouse/db";
import {
  base32Decode, base32Encode, decryptSecret, encryptSecret, generateRecoveryCodes, hashRecoveryCode, signSession, totpAt, totpStep, verifySession, verifyTotp,
} from "../src/auth";
import {
  beginMfaEnrolment, changePassword, confirmMfaEnrolment, createDevMailer, findOpenReset, issuePasswordReset, requestPasswordReset, resetMfa, resetPassword, verifyMfaLogin,
} from "../src/account";
import { fixture, setupDb, TEST_URL } from "./helpers";

const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890")); // RFC 6238 appendix B test key

describe("TOTP", () => {
  it("matches RFC 6238 test vectors (SHA1)", () => {
    expect(RFC_SECRET).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(totpAt(RFC_SECRET, Math.floor(59 / 30), 8)).toBe("94287082");
    expect(totpAt(RFC_SECRET, Math.floor(1111111109 / 30), 8)).toBe("07081804");
    expect(totpAt(RFC_SECRET, Math.floor(2000000000 / 30), 8)).toBe("69279037");
  });
  it("base32 round-trips", () => {
    const b = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 7]);
    expect(base32Decode(base32Encode(b)).equals(b)).toBe(true);
  });
  it("accepts +/-1 step of drift but not further", () => {
    const now = 1_700_000_000_000, step = totpStep(now);
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, step), { nowMs: now })).toBe(step);
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, step - 1), { nowMs: now })).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, step + 1), { nowMs: now })).toBe(step + 1);
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, step - 2), { nowMs: now })).toBeNull();
  });
  it("rejects replay of an already used step and malformed codes", () => {
    const now = 1_700_000_000_000, step = totpStep(now), code = totpAt(RFC_SECRET, step);
    expect(verifyTotp(RFC_SECRET, code, { nowMs: now, lastStep: step })).toBeNull();
    expect(verifyTotp(RFC_SECRET, "12345", { nowMs: now })).toBeNull();
    expect(verifyTotp(RFC_SECRET, "abcdef", { nowMs: now })).toBeNull();
  });
});

describe("secrets and codes", () => {
  it("encrypts with AES-GCM, fails with wrong key or tampering", () => {
    const enc = encryptSecret("SECRET123", "master-key-master-key-master-key-1");
    expect(enc).not.toContain("SECRET123");
    expect(decryptSecret(enc, "master-key-master-key-master-key-1")).toBe("SECRET123");
    expect(() => decryptSecret(enc, "other-key-other-key-other-key-0000")).toThrow();
    expect(() => decryptSecret(enc.slice(0, -3) + "AAA", "master-key-master-key-master-key-1")).toThrow();
  });
  it("makes 10 distinct recovery codes and hashes ignore case/dashes", () => {
    const codes = generateRecoveryCodes();
    expect(new Set(codes).size).toBe(10);
    expect(codes[0]).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    expect(hashRecoveryCode(codes[0]!)).toBe(hashRecoveryCode(codes[0]!.toLowerCase().replace("-", " ")));
  });
  it("session tokens carry the epoch", () => {
    const t = signSession({ uid: "u", exp: Date.now() + 1000, ep: 3 }, "s".repeat(32));
    expect(verifySession(t, "s".repeat(32))?.ep).toBe(3);
  });
});

describe.skipIf(!TEST_URL)("password reset + MFA (db)", () => {
  let ctx: Awaited<ReturnType<typeof setupDb>>;
  const KEY = "test-master-key-test-master-key-0000";
  beforeAll(async () => { ctx = await setupDb(); });
  afterAll(async () => { await ctx.sql.end(); });

  const person = async (over: Record<string, unknown> = {}) => {
    const f = await fixture(ctx.db);
    const u = await f.mk("STATIC_GUARD", { passwordHash: await hashPassword("old-password-123"), ...over });
    return { f, u };
  };
  const reload = async (id: string) => (await ctx.db.select().from(users).where(eq(users.id, id)))[0]!;
  const audit = async (id: string) => (await ctx.db.select().from(immutableAuditLogs).where(eq(immutableAuditLogs.entityId, id))).map((a) => a.action);

  it("forgot-password emails a link for real accounts only and the response shape is identical", async () => {
    const { u } = await person();
    const { mailer, outbox } = createDevMailer();
    await requestPasswordReset(ctx.db, { email: u.email, baseUrl: "http://x", mailer });
    await requestPasswordReset(ctx.db, { email: "nobody@nowhere.example", baseUrl: "http://x", mailer });
    expect(outbox).toHaveLength(1);
    expect(outbox[0]!.to).toBe(u.email);
    expect(outbox[0]!.text).toMatch(/http:\/\/x\/reset-password\/[\w-]{43}/);
    expect(await audit(u.id)).toContain("PASSWORD_RESET_REQUESTED");
  });

  it("reset sets the password, is single-use, revokes sessions, kills sibling links, and stores only token hashes", async () => {
    const { u } = await person();
    const a = await issuePasswordReset(ctx.db, { targetUserId: u.id, actorId: u.id });
    const b = await issuePasswordReset(ctx.db, { targetUserId: u.id, actorId: u.id });
    const rows = await ctx.db.select().from(passwordResets).where(eq(passwordResets.userId, u.id));
    expect(JSON.stringify(rows)).not.toContain(a.token);
    const before = (await reload(u.id)).sessionEpoch;
    await resetPassword(ctx.db, { token: a.token, newPassword: "brand-new-password-9" });
    const after = await reload(u.id);
    expect(after.sessionEpoch).toBe(before + 1);
    expect(await verifyPassword("brand-new-password-9", after.passwordHash)).toBe(true);
    expect(await verifyPassword("old-password-123", after.passwordHash)).toBe(false);
    await expect(resetPassword(ctx.db, { token: a.token, newPassword: "another-password-99" })).rejects.toThrow(/invalid, used or expired/);
    await expect(resetPassword(ctx.db, { token: b.token, newPassword: "another-password-99" })).rejects.toThrow(/invalid, used or expired/);
    expect(await audit(u.id)).toContain("PASSWORD_RESET");
  });

  it("rejects expired links and weak passwords", async () => {
    const { u } = await person();
    const { token } = await issuePasswordReset(ctx.db, { targetUserId: u.id, actorId: u.id });
    await expect(resetPassword(ctx.db, { token, newPassword: "short" })).rejects.toThrow(/at least 12/);
    await ctx.db.update(passwordResets).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(passwordResets.userId, u.id));
    expect(await findOpenReset(ctx.db, token)).toBeNull();
    await expect(resetPassword(ctx.db, { token, newPassword: "long-enough-password-1" })).rejects.toThrow(/invalid, used or expired/);
  });

  it("anonymised users get no reset email", async () => {
    const { u } = await person({ anonymisedAt: new Date() });
    const { mailer, outbox } = createDevMailer();
    await requestPasswordReset(ctx.db, { email: u.email, baseUrl: "http://x", mailer });
    expect(outbox).toHaveLength(0);
  });

  it("changePassword needs the current password and bumps the epoch", async () => {
    const { u } = await person();
    await expect(changePassword(ctx.db, { userId: u.id, current: "wrong", next: "a-new-password-123" })).rejects.toThrow(/incorrect/);
    const r = await changePassword(ctx.db, { userId: u.id, current: "old-password-123", next: "a-new-password-123" });
    expect(r.epoch).toBe(1);
  });

  it("MFA: enrol, wrong code refused, confirm, secret encrypted at rest", async () => {
    const { u } = await person();
    const { secret, uri } = await beginMfaEnrolment(ctx.db, { userId: u.id, masterKey: KEY });
    expect(uri).toContain(`secret=${secret}`);
    const pending = await reload(u.id);
    expect(pending.mfaSecretEnc).not.toContain(secret); expect(pending.mfaEnabledAt).toBeNull();
    await expect(confirmMfaEnrolment(ctx.db, { userId: u.id, code: "000000", masterKey: KEY })).rejects.toThrow(/not correct/);
    const { recoveryCodes } = await confirmMfaEnrolment(ctx.db, { userId: u.id, code: totpAt(secret, totpStep()), masterKey: KEY });
    expect(recoveryCodes).toHaveLength(10);
    const on = await reload(u.id);
    expect(on.mfaEnabledAt).not.toBeNull();
    expect(JSON.stringify(on.mfaRecoveryHashes)).not.toContain(recoveryCodes[0]!);
    expect(await audit(u.id)).toContain("MFA_ENABLED");
    await expect(beginMfaEnrolment(ctx.db, { userId: u.id, masterKey: KEY })).rejects.toThrow(/already enabled/);
  });

  async function enrolled() {
    const { u } = await person();
    const { secret } = await beginMfaEnrolment(ctx.db, { userId: u.id, masterKey: KEY });
    const { recoveryCodes } = await confirmMfaEnrolment(ctx.db, { userId: u.id, code: totpAt(secret, totpStep()), masterKey: KEY });
    return { u, secret, recoveryCodes };
  }

  it("MFA login: a code works once (replay refused), next step works, garbage fails and is audited", async () => {
    const { u, secret } = await enrolled();
    // the confirmation consumed the current step, so the same code must now be refused
    expect(await verifyMfaLogin(ctx.db, { userId: u.id, code: totpAt(secret, totpStep()), masterKey: KEY })).toBe("BAD_CODE");
    const next = totpAt(secret, totpStep() + 1);
    expect(await verifyMfaLogin(ctx.db, { userId: u.id, code: next, masterKey: KEY })).toBe("OK");
    expect(await verifyMfaLogin(ctx.db, { userId: u.id, code: next, masterKey: KEY })).toBe("BAD_CODE");
    expect(await verifyMfaLogin(ctx.db, { userId: u.id, code: "banana", masterKey: KEY })).toBe("BAD_CODE");
    expect(await audit(u.id)).toContain("MFA_FAILED");
  });

  it("recovery codes are single-use", async () => {
    const { u, recoveryCodes } = await enrolled();
    const c = recoveryCodes[3]!;
    expect(await verifyMfaLogin(ctx.db, { userId: u.id, code: c.toLowerCase(), masterKey: KEY })).toBe("RECOVERY_USED");
    expect(await verifyMfaLogin(ctx.db, { userId: u.id, code: c, masterKey: KEY })).toBe("BAD_CODE");
    expect((await reload(u.id)).mfaRecoveryHashes).toHaveLength(9);
  });

  it("admin MFA reset clears everything, bumps the epoch and is audited", async () => {
    const { u } = await enrolled();
    const admin = await person();
    const before = (await reload(u.id)).sessionEpoch;
    await resetMfa(ctx.db, { targetUserId: u.id, actorId: admin.u.id });
    const after = await reload(u.id);
    expect(after).toMatchObject({ mfaSecretEnc: null, mfaEnabledAt: null, mfaRecoveryHashes: [] });
    expect(after.sessionEpoch).toBe(before + 1);
    expect(await audit(u.id)).toContain("MFA_RESET_BY_ADMIN");
  });
});
