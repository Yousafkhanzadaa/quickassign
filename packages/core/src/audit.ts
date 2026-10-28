import type { Tx } from "./db.js";

type Actor = "user" | "system" | "gateway" | "worker" | "admin";

/**
 * Appends to the audit log. Details must never contain message content, file contents,
 * phone numbers or names; record identifiers and outcomes only.
 */
export async function audit(trx: Tx, userId: string | null, actor: Actor, action: string, details: Record<string, string | number | boolean | null> = {}): Promise<void> {
  await trx
    .insertInto("app.audit_log")
    .values({ user_id: userId, actor, action, details: JSON.stringify(details) })
    .execute();
}
