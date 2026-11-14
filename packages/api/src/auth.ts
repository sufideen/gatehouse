import { createHmac, timingSafeEqual } from "node:crypto";

/** Stateless signed session token: base64url(payload).base64url(hmac). The user is re-loaded from the DB on every request. */
export type SessionPayload = { uid: string; exp: number };

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
