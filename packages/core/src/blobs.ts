import { randomUUID } from "node:crypto";
import type { Tx } from "./db.js";
import type { ContentKeys } from "./keys.js";
import type { BlobPurpose } from "./schema.js";
import { aad, open, seal } from "./seal.js";

export const MAX_BLOB_BYTES = 50 * 1024 * 1024;

/** Stores a file encrypted with the tenant's content key. */
export async function putBlob(
  trx: Tx,
  keys: ContentKeys,
  userId: string,
  purpose: BlobPurpose,
  mime: string,
  data: Buffer,
  expiresAt?: Date,
): Promise<string> {
  if (data.length === 0 || data.length > MAX_BLOB_BYTES) throw new Error("blob size out of range");
  const id = randomUUID();
  const key = await keys.get(trx, userId);
  await trx
    .insertInto("app.blobs")
    .values({
      id,
      user_id: userId,
      purpose,
      mime,
      size: data.length,
      data_enc: seal(key, data, aad("blob", userId, id)),
      expires_at: expiresAt ?? null,
    })
    .execute();
  return id;
}

export async function getBlob(
  trx: Tx,
  keys: ContentKeys,
  userId: string,
  id: string,
): Promise<{ mime: string; purpose: BlobPurpose; data: Buffer } | null> {
  const row = await trx.selectFrom("app.blobs").select(["mime", "purpose", "data_enc"]).where("id", "=", id).executeTakeFirst();
  if (!row) return null;
  const key = await keys.get(trx, userId);
  return { mime: row.mime, purpose: row.purpose, data: open(key, row.data_enc, aad("blob", userId, id)) };
}
