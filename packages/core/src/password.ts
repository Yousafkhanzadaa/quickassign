// Password hashing for local accounts: scrypt with a random salt per password.
//
//   stored = "scrypt$" N "$" r "$" p "$" base64(salt) "$" base64(key)
//
// N=2^15, r=8, p=3 is one of OWASP's recommended scrypt settings (32 MiB per hash). The
// parameters are stored with each hash, so they can be raised later: needsRehash() tells
// the caller to re-hash on the next successful sign-in.
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

const N = 2 ** 15;
const R = 8;
const P = 3;
const SALT_BYTES = 16;
const KEY_BYTES = 32;
const MAX_MEM = 64 * 1024 * 1024;

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

function derive(password: string, salt: Buffer, keyLen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // NFKC so the same password typed on different keyboards hashes the same way.
    scrypt(password.normalize("NFKC"), salt, keyLen, { ...opts, maxmem: MAX_MEM }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, KEY_BYTES, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

/** Checks a password against a stored hash in constant time. Malformed hashes never match. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [n, r, p] = parts.slice(1, 4).map(Number);
  // Bounds keep a tampered hash from making the server burn CPU or memory.
  if (!n || !r || !p || n > 2 ** 20 || (n & (n - 1)) !== 0 || r > 32 || p > 16) return false;
  const salt = Buffer.from(parts[4]!, "base64");
  const expected = Buffer.from(parts[5]!, "base64");
  if (salt.length < SALT_BYTES || expected.length < 16) return false;
  const key = await derive(password, salt, expected.length, { N: n, r, p });
  return timingSafeEqual(key, expected);
}

/** True when a stored hash uses weaker or different parameters than hashPassword(). */
export function needsRehash(stored: string): boolean {
  return !stored.startsWith(`scrypt$${N}$${R}$${P}$`);
}

let decoy: Promise<string> | undefined;

/**
 * Spends the same time as a real check, for sign-ins with an unknown email address, so
 * response times don't reveal which addresses have accounts.
 */
export async function verifyAgainstDecoy(password: string): Promise<false> {
  decoy ??= hashPassword(randomBytes(16).toString("hex"));
  await verifyPassword(password, await decoy);
  return false;
}
