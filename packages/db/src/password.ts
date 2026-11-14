import { randomBytes, scrypt as _scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(_scrypt) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const N = 16384, R = 8, P = 1, LEN = 64;

/** scrypt$N$salt$hash (base64). Slow by design; no external dependency. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, LEN, { N, r: R, p: P });
  return `scrypt$${N}$${salt.toString("base64")}$${key.toString("base64")}`;
}

const DUMMY = `scrypt$${N}$${Buffer.alloc(16).toString("base64")}$${Buffer.alloc(LEN).toString("base64")}`;

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  // Always do the work, even for unknown users, so response time doesn't reveal which emails exist.
  const parts = (stored ?? DUMMY).split("$");
  if (parts[0] !== "scrypt" || parts.length !== 4) return false;
  const salt = Buffer.from(parts[2]!, "base64"), want = Buffer.from(parts[3]!, "base64");
  const got = await scrypt(password, salt, want.length, { N: Number(parts[1]), r: R, p: P });
  return timingSafeEqual(got, want) && stored != null;
}
