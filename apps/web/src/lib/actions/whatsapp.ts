"use server";
import { audit, GatewayError, withTenant } from "@qa/core";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, gateway } from "../server";
import { normalizePkPhone } from "../phone";
import { requireProfile } from "../session";

export interface LinkResult {
  ok: boolean;
  error?: string;
}

const Start = z.object({ method: z.enum(["qr", "code"]), phone: z.string().max(32).optional() });

export async function startLink(input: { method: "qr" | "code"; phone?: string }): Promise<LinkResult> {
  const { user } = await requireProfile();
  const parsed = Start.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };
  let phone: string | undefined;
  if (parsed.data.method === "code") {
    const p = normalizePkPhone(parsed.data.phone ?? "");
    if (!p) return { ok: false, error: "Enter your WhatsApp number with country code, e.g. +92 300 1234567." };
    phone = p;
  }
  try {
    await gateway().startLink(user.id, parsed.data.method, phone);
    await withTenant(db(), user.id, (trx) => audit(trx, user.id, "user", "wa_link_started", { method: parsed.data.method }));
    return { ok: true };
  } catch (err) {
    if (err instanceof GatewayError && err.code === "already_linked") return { ok: false, error: "WhatsApp is already linked. Unlink first to link again." };
    if (err instanceof GatewayError && err.code === "bad_phone") return { ok: false, error: "That phone number doesn't look right." };
    return { ok: false, error: "Couldn't start linking right now. Please try again in a minute." };
  }
}

export async function unlinkWhatsApp(): Promise<LinkResult> {
  const { user } = await requireProfile();
  try {
    await gateway().unlink(user.id);
  } catch {
    return { ok: false, error: "Couldn't reach the WhatsApp service. Try again, or remove the device from your phone." };
  }
  await withTenant(db(), user.id, (trx) => audit(trx, user.id, "user", "wa_unlinked", {}));
  revalidatePath("/whatsapp");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function refreshGroups(): Promise<LinkResult> {
  const { user } = await requireProfile();
  try {
    await gateway().refreshGroups(user.id);
  } catch {
    return { ok: false, error: "WhatsApp isn't connected right now." };
  }
  revalidatePath("/groups");
  return { ok: true };
}
