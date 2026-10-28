// Safepay (https://getsafepay.pk): SBP-regulated payment gateway used for JazzCash,
// Easypaisa, Raast and card payments through one hosted checkout.
//
// Flow: create a payment session (tracker) for an exact paisa amount -> get a
// short-lived checkout token -> redirect the student to Safepay's hosted page -> on
// return or webhook, confirm the payment with Safepay's reporter API from our server.
// Redirect parameters and webhook bodies are never trusted on their own.
import { createHmac, timingSafeEqual } from "node:crypto";

export type SafepayEnv = "sandbox" | "production";

export interface SafepayConfig {
  env: SafepayEnv;
  /** Public merchant API key ("sec_..."). */
  apiKey: string;
  /** Secret key, sent as X-SFPY-MERCHANT-SECRET. Server only. */
  secretKey: string;
  /** Webhook shared secret from Dashboard > Developers > Endpoints. */
  webhookSecret?: string;
}

export type PaymentLookup =
  | { status: "paid"; amountPaisa: number; currency: string }
  | { status: "pending" }
  | { status: "failed" | "expired" | "cancelled" | "refunded"; reason: string };

const API_BASE: Record<SafepayEnv, string> = {
  sandbox: "https://sandbox.api.getsafepay.com",
  production: "https://api.getsafepay.com",
};

const CHECKOUT_BASE: Record<SafepayEnv, string> = {
  sandbox: "https://sandbox.api.getsafepay.com/embedded/",
  production: "https://getsafepay.com/embedded/",
};

const TRACKER_RE = /^track_[A-Za-z0-9_-]{6,120}$/;

export class SafepayError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(`safepay request failed (${status})`);
    this.name = "SafepayError";
  }
}

type Json = Record<string, unknown>;

function rec(v: unknown): Json | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null;
}

/** Error text that is safe to log: keys, tokens and long hex strings removed. */
export function redact(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/sec_[A-Za-z0-9-]{6,}/g, "[key]")
    .replace(/track_[A-Za-z0-9_-]{6,}/g, "[tracker]")
    .replace(/\b[a-f0-9]{32,}\b/gi, "[hex]")
    .replace(/"(merchant_api_key|api_key|secret|token|tbt|authorization|password)"\s*:\s*"[^"]*"/gi, '"$1":"[redacted]"')
    .slice(0, 200);
}

export class Safepay {
  readonly env: SafepayEnv;
  readonly #cfg: SafepayConfig;
  readonly #fetch: typeof fetch;

  constructor(cfg: SafepayConfig, fetchImpl: typeof fetch = fetch) {
    if (!cfg.apiKey || !cfg.secretKey) throw new Error("safepay: apiKey and secretKey are required");
    this.#cfg = cfg;
    this.env = cfg.env;
    this.#fetch = fetchImpl;
  }

  async #call(method: "GET" | "POST", path: string, body?: Json): Promise<unknown> {
    const res = await this.#fetch(API_BASE[this.#cfg.env] + path, {
      method,
      headers: {
        "X-SFPY-MERCHANT-SECRET": this.#cfg.secretKey,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    if (!res.ok) throw new SafepayError(res.status, redact(text));
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new SafepayError(res.status, "non-JSON response");
    }
  }

  /** Creates a payment session and returns the hosted checkout URL. */
  async createCheckout(opts: { amountPaisa: number; orderId: string; redirectUrl: string; cancelUrl: string }): Promise<{ tracker: string; url: string }> {
    if (!Number.isInteger(opts.amountPaisa) || opts.amountPaisa <= 0) throw new Error("safepay: invalid amount");
    const setup = await this.#call("POST", "/order/payments/v3/", {
      merchant_api_key: this.#cfg.apiKey,
      intent: "CYBERSOURCE",
      mode: "payment",
      currency: "PKR",
      amount: opts.amountPaisa,
      // Safepay accepts only order_id here.
      metadata: { order_id: opts.orderId },
    });
    const tracker = rec(rec(rec(setup)?.data)?.tracker)?.token;
    if (typeof tracker !== "string" || !TRACKER_RE.test(tracker)) throw new SafepayError(502, "no tracker in session response");

    const passport = await this.#call("POST", "/client/passport/v1/token");
    const data = rec(passport)?.data;
    const tbt = typeof data === "string" ? data : rec(data)?.token;
    if (typeof tbt !== "string" || tbt.length < 10) throw new SafepayError(502, "no checkout token in response");

    const params = new URLSearchParams({
      environment: this.#cfg.env,
      tracker,
      tbt,
      source: "hosted",
      redirect_url: opts.redirectUrl,
      cancel_url: opts.cancelUrl,
    });
    return { tracker, url: `${CHECKOUT_BASE[this.#cfg.env]}?${params.toString()}` };
  }

  /**
   * Asks Safepay (server to server) what actually happened to a payment. With
   * expectedOrderId, the tracker must also carry that order id (set at creation).
   */
  async lookup(tracker: string, expectedOrderId?: string): Promise<PaymentLookup> {
    if (!TRACKER_RE.test(tracker)) throw new Error("safepay: invalid tracker");
    const body = await this.#call("GET", `/reporter/api/v1/payments/${encodeURIComponent(tracker)}`);
    return interpretTracker(body, tracker, this.#cfg.apiKey, expectedOrderId);
  }

  /**
   * Verifies X-SFPY-SIGNATURE: hex HMAC-SHA512 of the JSON body. Safepay's PHP SDK signs
   * the raw body; its WooCommerce plugin re-encodes the parsed body compactly. Accept
   * either form (both need the secret).
   */
  verifyWebhook(rawBody: string, signature: string | null): boolean {
    const secret = this.#cfg.webhookSecret;
    if (!secret || !signature) return false;
    const given = signature.trim().toLowerCase();
    if (!/^[0-9a-f]{128}$/.test(given)) return false;
    const matches = (payload: string) =>
      timingSafeEqual(Buffer.from(given, "hex"), createHmac("sha512", secret).update(payload, "utf8").digest());
    if (matches(rawBody)) return true;
    let compact: string;
    try {
      compact = JSON.stringify(JSON.parse(rawBody));
    } catch {
      return false;
    }
    return compact !== rawBody && matches(compact);
  }
}

/** The order id we attached at creation: {order_id: "…"} (session) or {order_id: {value: "…"}} (reporter). */
function orderIdOf(t: Json): string | undefined {
  const meta = rec(rec(t.metadata)?.data) ?? rec(t.metadata);
  const v = meta?.order_id;
  if (typeof v === "string") return v;
  const value = rec(v)?.value;
  return typeof value === "string" ? value : undefined;
}

/**
 * Interprets a reporter (or session) payload. Paid requires TRACKER_ENDED on a payment
 * tracker, our merchant key, our order id (when given and present) and a readable
 * integer amount; anything else is pending or a failure.
 */
export function interpretTracker(payload: unknown, tracker: string, expectedApiKey: string, expectedOrderId?: string): PaymentLookup {
  const data = rec(rec(payload)?.data) ?? rec(payload);
  const t = rec(data?.tracker) ?? data;
  if (!t) return { status: "failed", reason: "unreadable_response" };
  const token = typeof t.token === "string" ? t.token : tracker;
  if (token !== tracker) return { status: "failed", reason: "tracker_mismatch" };
  // Only payment trackers count (not, for example, a saved-card "instrument" session).
  if (t.mode !== undefined && t.mode !== "payment") return { status: "failed", reason: "not_a_payment" };
  if (expectedOrderId) {
    const orderId = orderIdOf(t);
    if (orderId !== undefined && orderId !== expectedOrderId) return { status: "failed", reason: "order_mismatch" };
  }
  const state = typeof t.state === "string" ? t.state : "";

  switch (state) {
    case "TRACKER_ENDED": {
      const client = typeof t.client === "string" ? t.client : rec(t.client)?.api_key;
      if (client !== expectedApiKey) return { status: "failed", reason: "merchant_mismatch" };
      const totals = rec(t.purchase_totals);
      const money = rec(totals?.quote_amount) ?? rec(totals?.base_amount);
      const amount = money?.amount;
      const currency = money?.currency;
      if (typeof amount !== "number" || !Number.isInteger(amount) || typeof currency !== "string") {
        return { status: "failed", reason: "amount_unreadable" };
      }
      return { status: "paid", amountPaisa: amount, currency };
    }
    case "TRACKER_STARTED":
    case "TRACKER_ENROLLED":
    case "TRACKER_AUTHORIZED":
      return { status: "pending" };
    case "TRACKER_CANCELLED":
      return { status: "cancelled", reason: "cancelled" };
    case "TRACKER_EXPIRED":
      return { status: "expired", reason: "expired" };
    case "TRACKER_REFUNDED":
    case "TRACKER_PARTIAL_REFUND":
      return { status: "refunded", reason: state.toLowerCase() };
    default:
      return { status: "failed", reason: state ? state.toLowerCase() : "unknown_state" };
  }
}

/** Extracts the event type and tracker token from a webhook body (already verified). */
export function parseWebhook(rawBody: string): { type: string | null; tracker: string | null } {
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return { type: null, tracker: null };
  }
  const root = rec(body);
  const data = rec(root?.data);
  const pick = (v: unknown): string | null => {
    if (typeof v === "string" && TRACKER_RE.test(v)) return v;
    const tok = rec(v)?.token;
    return typeof tok === "string" && TRACKER_RE.test(tok) ? tok : null;
  };
  const type = typeof root?.type === "string" ? root.type : typeof root?.event === "string" ? root.event : null;
  const tracker = pick(data?.tracker) ?? pick(root?.tracker) ?? pick(rec(root?.notification)?.tracker) ?? pick(data?.token);
  return { type, tracker };
}
