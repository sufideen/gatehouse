import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

/** Stateless signed token: base64url(payload).base64url(hmac). `ep` is the user's session epoch (bumped to revoke all sessions). */
export type SessionPayload = { uid: string; exp: number; ep?: number };

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function signSession(p: SessionPayload, secret: string): string {
  const body = b64(JSON.stringify(p));
  return `${body}.${b64(createHmac("sha256", secret).update(body).digest())}`;
}

export function verifySession(token: string | undefined, secret: string, nowMs = Date.now()): SessionPayload | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const want = createHmac("sha256", secret).update(body).digest();
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString()) as SessionPayload;
    return typeof p.uid === "string" && typeof p.exp === "number" && p.exp > nowMs ? p : null;
  } catch { return null; }
}

/** In-memory sliding-window limiter (PoC; use Redis when running more than one instance). */
export function createRateLimiter(max: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return {
    allow(key: string, now = Date.now()) {
      const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
      if (recent.length >= max) { hits.set(key, recent); return false; }
      recent.push(now); hits.set(key, recent); return true;
    },
    reset(key: string) { hits.delete(key); },
  };
}

export const MIN_PASSWORD_LENGTH = 12;
export const passwordProblem = (pw: string) => (pw.length < MIN_PASSWORD_LENGTH ? `Password must be at least ${MIN_PASSWORD_LENGTH} characters` : null);

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

// ---------------------------------------------------------------- TOTP (RFC 6238, HMAC-SHA1, 6 digits, 30 s)

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(s: string): Buffer {
  let bits = 0, value = 0; const out: number[] = [];
  for (const ch of s.replace(/=+$/, "").toUpperCase()) {
    const i = B32.indexOf(ch); if (i < 0) throw new Error("bad base32");
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export const generateTotpSecret = () => base32Encode(randomBytes(20));
export const totpStep = (nowMs = Date.now()) => Math.floor(nowMs / 30_000);

export function totpAt(secretB32: string, step: number, digits = 6): string {
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", base32Decode(secretB32)).update(counter).digest();
  const o = h[h.length - 1]! & 15;
  const code = ((h[o]! & 127) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(code % 10 ** digits).padStart(digits, "0");
}

/** Accepts the current step and +/- 1 (clock drift). Returns the matched step, or null. Steps <= lastStep are rejected (replay). */
export function verifyTotp(secretB32: string, code: string, o: { nowMs?: number; lastStep?: number | null } = {}): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const now = totpStep(o.nowMs);
  for (const step of [now, now - 1, now + 1]) {
    if (o.lastStep != null && step <= o.lastStep) continue;
    const want = Buffer.from(totpAt(secretB32, step)), got = Buffer.from(code);
    if (timingSafeEqual(want, got)) return step;
  }
  return null;
}

export const otpauthUri = (email: string, secretB32: string, issuer = "Gatehouse") =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

// ---------------------------------------------------------------- secret encryption at rest (AES-256-GCM)

const aesKey = (master: string) => Buffer.from(hkdfSync("sha256", master, "gatehouse-mfa", "totp-secret-v1", 32));
export function encryptSecret(plain: string, master: string): string {
  const iv = randomBytes(12), c = createCipheriv("aes-256-gcm", aesKey(master), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1.${b64(iv)}.${b64(enc)}.${b64(c.getAuthTag())}`;
}
export function decryptSecret(token: string, master: string): string {
  const [v, iv, enc, tag] = token.split(".");
  if (v !== "v1" || !iv || !enc || !tag) throw new Error("bad ciphertext");
  const d = createDecipheriv("aes-256-gcm", aesKey(master), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(enc, "base64url")), d.final()]).toString("utf8");
}

// ---------------------------------------------------------------- recovery codes

const RC = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no look-alikes
/** 10 codes like ABCDE-FGHJK (~50 bits each). Show once; store only hashes. */
export function generateRecoveryCodes(n = 10): string[] {
  return Array.from({ length: n }, () => {
    const c = Array.from({ length: 10 }, () => RC[randomInt(RC.length)]).join("");
    return `${c.slice(0, 5)}-${c.slice(5)}`;
  });
}
export const normaliseRecoveryCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
export const hashRecoveryCode = (s: string) => sha256(normaliseRecoveryCode(s));
