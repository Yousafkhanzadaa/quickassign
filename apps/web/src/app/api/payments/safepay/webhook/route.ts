import { parseWebhook, verifyAndFulfil } from "@qa/core";
import { paymentsProvider, safepay } from "@/lib/billing";
import { db } from "@/lib/server";

export const dynamic = "force-dynamic";

const MAX_BODY = 64 * 1024;

/**
 * Safepay webhook. The signature proves the call came from Safepay, but the payment is
 * still confirmed with Safepay's reporter API before anything is granted: the webhook is
 * only a hint about which payment to check.
 */
export async function POST(request: Request) {
  if (paymentsProvider() !== "safepay") return new Response("not found", { status: 404 });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) return new Response("too large", { status: 413 });
  const raw = await request.text();
  if (raw.length > MAX_BODY) return new Response("too large", { status: 413 });

  const sp = safepay();
  if (!sp.verifyWebhook(raw, request.headers.get("x-sfpy-signature"))) {
    return new Response("invalid signature", { status: 401 });
  }
  // Any signed event that names a tracker triggers the same server-side check; the
  // event type isn't needed (and isn't trusted) because Safepay's API decides.
  const { tracker } = parseWebhook(raw);
  if (!tracker) return new Response("ignored", { status: 200 });

  try {
    await verifyAndFulfil(db(), sp, tracker);
  } catch (err) {
    console.error("webhook verification failed:", (err as Error).name);
    return new Response("retry", { status: 500 }); // Safepay retries
  }
  return new Response("ok", { status: 200 });
}
