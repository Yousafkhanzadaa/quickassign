// Envelope encryption shared by every QuickAssign service.
//
// Wire format (byte-compatible with gateway/internal/seal/seal.go):
//   sealed = 0x01 || nonce (12 bytes) || AES-256-GCM ciphertext || tag (16 bytes)
//   aad    = "qa/v1/" + purpose + "/" + tenant + "/" + record
//
// Binding the AAD to purpose, tenant and record means a ciphertext copied into another
// row, column or tenant fails to decrypt instead of leaking.
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

const VERSION = 0x01;
const NONCE_SIZE = 12;
const TAG_SIZE = 16;
export const KEY_SIZE = 32;

export class DecryptError extends Error {
  constructor() {
    super("seal: decryption failed");
    this.name = "DecryptError";
  }
}

export function aad(purpose: string, tenant: string, record: string): Buffer {
  return Buffer.from(`qa/v1/${purpose}/${tenant}/${record}`, "utf8");
}

function checkKey(key: Buffer): void {
  if (key.length !== KEY_SIZE) throw new Error(`seal: key must be ${KEY_SIZE} bytes`);
}

export function seal(key: Buffer, plaintext: Buffer, ad: Buffer): Buffer {
  checkKey(key);
  const nonce = randomBytes(NONCE_SIZE);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(ad);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), nonce, ct, cipher.getAuthTag()]);
}

export function open(key: Buffer, sealed: Buffer, ad: Buffer): Buffer {
  checkKey(key);
  if (sealed.length < 1 + NONCE_SIZE + TAG_SIZE || sealed[0] !== VERSION) throw new DecryptError();
  const nonce = sealed.subarray(1, 1 + NONCE_SIZE);
  const tag = sealed.subarray(sealed.length - TAG_SIZE);
  const ct = sealed.subarray(1 + NONCE_SIZE, sealed.length - TAG_SIZE);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(ad);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  } catch {
    throw new DecryptError();
  }
}

export function sealText(key: Buffer, text: string | null | undefined, purpose: string, tenant: string, record: string): Buffer | null {
  if (text == null || text === "") return null;
  return seal(key, Buffer.from(text, "utf8"), aad(purpose, tenant, record));
}

export function openText(key: Buffer, sealed: Buffer | null | undefined, purpose: string, tenant: string, record: string): string | null {
  if (!sealed || sealed.length === 0) return null;
  return open(key, sealed, aad(purpose, tenant, record)).toString("utf8");
}

/** Key-encryption key. Data keys are only ever stored wrapped by a KEK. */
export class Kek {
  readonly id: string;
  readonly #key: Buffer;

  private constructor(id: string, key: Buffer) {
    this.id = id;
    this.#key = key;
  }

  static parse(id: string, encoded: string): Kek {
    if (!id.trim()) throw new Error("seal: KEK id is empty");
    const normalized = encoded.trim().replace(/-/g, "+").replace(/_/g, "/");
    const raw = Buffer.from(normalized, "base64");
    if (raw.length !== KEY_SIZE) throw new Error(`seal: KEK ${id} must decode to ${KEY_SIZE} bytes`);
    return new Kek(id, raw);
  }

  wrap(dek: Buffer, purpose: string, tenant: string): Buffer {
    return seal(this.#key, dek, aad("dek", tenant, purpose));
  }

  unwrap(wrapped: Buffer, purpose: string, tenant: string): Buffer {
    return open(this.#key, wrapped, aad("dek", tenant, purpose));
  }

  /** HKDF-SHA256 subkey, identical to the Go DeriveSubkey. */
  deriveSubkey(info: string): Buffer {
    return Buffer.from(hkdfSync("sha256", this.#key, Buffer.from("quickassign"), Buffer.from(info), KEY_SIZE));
  }
}

export function randomKey(size = KEY_SIZE): Buffer {
  return randomBytes(size);
}
