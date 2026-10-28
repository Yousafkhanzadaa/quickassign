import type { Tx } from "./db.js";
import { Kek, randomKey } from "./seal.js";

/**
 * Per-tenant content keys. Each student's data key is random, stored only wrapped by
 * the application KEK, and cached briefly in memory.
 */
export class ContentKeys {
  readonly #kek: Kek;
  readonly #cache = new Map<string, { key: Buffer; at: number }>();
  readonly #ttlMs: number;

  constructor(kek: Kek, ttlMs = 10 * 60_000) {
    this.#kek = kek;
    this.#ttlMs = ttlMs;
  }

  async get(trx: Tx, userId: string): Promise<Buffer> {
    const hit = this.#cache.get(userId);
    if (hit && Date.now() - hit.at < this.#ttlMs) return hit.key;

    let row = await trx.selectFrom("app.tenant_keys").select(["kek_id", "wrapped_dek"]).where("user_id", "=", userId).executeTakeFirst();
    if (!row) {
      const wrapped = this.#kek.wrap(randomKey(), "content", userId);
      await trx
        .insertInto("app.tenant_keys")
        .values({ user_id: userId, kek_id: this.#kek.id, wrapped_dek: wrapped })
        .onConflict((oc) => oc.column("user_id").doNothing())
        .execute();
      row = await trx.selectFrom("app.tenant_keys").select(["kek_id", "wrapped_dek"]).where("user_id", "=", userId).executeTakeFirstOrThrow();
    }
    if (row.kek_id !== this.#kek.id) throw new Error(`content key wrapped with unknown KEK ${row.kek_id}`);
    const key = this.#kek.unwrap(row.wrapped_dek, "content", userId);
    this.#cache.set(userId, { key, at: Date.now() });
    return key;
  }

  forget(userId: string): void {
    const hit = this.#cache.get(userId);
    if (hit) hit.key.fill(0);
    this.#cache.delete(userId);
  }
}
