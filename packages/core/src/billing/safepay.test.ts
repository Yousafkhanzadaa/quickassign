import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { interpretTracker, parseWebhook, redact, Safepay } from "./safepay.js";

const KEY = "sec_test_merchant_key_123";
const TRACKER = "track_0123456789abcdef";
const cfg = { env: "sandbox" as const, apiKey: KEY, secretKey: "secret-key-xyz-0123456789", webhookSecret: "whsec-0123456789abcdef" };

const ended = (over: Record<string, unknown> = {}) => ({
  data: {
    token: TRACKER,
    state: "TRACKER_ENDED",
    client: KEY,
    purchase_totals: { quote_amount: { amount: 50000, currency: "PKR" } },
    ...over,
  },
});

describe("interpretTracker", () => {
  it("accepts only an ended tracker for our merchant with a readable amount", () => {
    expect(interpretTracker(ended(), TRACKER, KEY)).toEqual({ status: "paid", amountPaisa: 50000, currency: "PKR" });
    expect(interpretTracker(ended({ client: { api_key: KEY } }), TRACKER, KEY).status).toBe("paid");
  });

  it("rejects another merchant, another tracker, or an unreadable amount", () => {
    expect(interpretTracker(ended({ client: "sec_someone_else" }), TRACKER, KEY)).toMatchObject({ status: "failed", reason: "merchant_mismatch" });
    expect(interpretTracker(ended({ client: undefined }), TRACKER, KEY)).toMatchObject({ status: "failed", reason: "merchant_mismatch" });
    expect(interpretTracker(ended({ token: "track_attackerchosen" }), TRACKER, KEY)).toMatchObject({ reason: "tracker_mismatch" });
    expect(interpretTracker(ended({ purchase_totals: { quote_amount: { amount: "50000", currency: "PKR" } } }), TRACKER, KEY)).toMatchObject({ reason: "amount_unreadable" });
    expect(interpretTracker(ended({ purchase_totals: { quote_amount: { amount: 500.5, currency: "PKR" } } }), TRACKER, KEY)).toMatchObject({ reason: "amount_unreadable" });
  });

  it("maps non-final and failed states", () => {
    for (const s of ["TRACKER_STARTED", "TRACKER_ENROLLED", "TRACKER_AUTHORIZED"]) {
      expect(interpretTracker({ data: { token: TRACKER, state: s } }, TRACKER, KEY).status).toBe("pending");
    }
    expect(interpretTracker({ data: { token: TRACKER, state: "TRACKER_CANCELLED" } }, TRACKER, KEY).status).toBe("cancelled");
    expect(interpretTracker({ data: { token: TRACKER, state: "TRACKER_EXPIRED" } }, TRACKER, KEY).status).toBe("expired");
    expect(interpretTracker({ data: { token: TRACKER, state: "TRACKER_REFUNDED" } }, TRACKER, KEY).status).toBe("refunded");
    expect(interpretTracker({ data: { token: TRACKER, state: "TRACKER_DISPUTED" } }, TRACKER, KEY).status).toBe("failed");
    expect(interpretTracker("garbage", TRACKER, KEY).status).toBe("failed");
  });
});

// Shape of a real sandbox reporter response for a paid card checkout (values replaced).
const ORDER = "2099e1e9-52df-4ea3-9170-7fef4d33ac74";
const reporterPaid = (over: Record<string, unknown> = {}) => ({
  ok: true,
  data: {
    token: TRACKER,
    environment: "sandbox",
    state: "TRACKER_ENDED",
    intent: "CYBERSOURCE",
    mode: "payment",
    entry_mode: "flex",
    metadata: { order_id: { token: "meta_1", tracker: TRACKER, key: "order_id", value: ORDER } },
    client: { token: "client_1", api_key: KEY, name: "Test merchant" },
    purchase_totals: {
      quote_amount: { currency: "PKR", amount: 50000 },
      base_amount: { currency: "PKR", amount: 50000 },
      conversion_rate: { base_currency: "PKR", quote_currency: "PKR", rate: 1 },
    },
    charge: { token: "ch_1", amount: { currency: "PKR", amount: 50000 }, fees: { currency: "PKR", amount: 3168 } },
    ...over,
  },
});

describe("interpretTracker with a real reporter response", () => {
  it("accepts a paid payment tracker bound to our order", () => {
    expect(interpretTracker(reporterPaid(), TRACKER, KEY, ORDER)).toEqual({ status: "paid", amountPaisa: 50000, currency: "PKR" });
  });

  it("rejects a tracker created for another order", () => {
    expect(interpretTracker(reporterPaid(), TRACKER, KEY, "11111111-2222-4333-8444-555555555555")).toMatchObject({
      status: "failed",
      reason: "order_mismatch",
    });
  });

  it("rejects trackers that are not payments", () => {
    expect(interpretTracker(reporterPaid({ mode: "instrument" }), TRACKER, KEY, ORDER)).toMatchObject({ reason: "not_a_payment" });
  });

  it("reads the order id from the session response shape too", () => {
    const session = { data: { tracker: { ...reporterPaid().data, metadata: { data: { order_id: ORDER } } } } };
    expect(interpretTracker(session, TRACKER, KEY, ORDER).status).toBe("paid");
    expect(interpretTracker(session, TRACKER, KEY, "other-order")).toMatchObject({ reason: "order_mismatch" });
  });
});

describe("webhooks", () => {
  const sp = new Safepay(cfg);
  const body = JSON.stringify({ type: "payment.succeeded", data: { tracker: TRACKER, state: "TRACKER_ENDED", amount: 50000 } });
  const sig = createHmac("sha512", cfg.webhookSecret).update(body).digest("hex");

  it("verifies the HMAC-SHA512 signature over the raw body", () => {
    expect(sp.verifyWebhook(body, sig)).toBe(true);
    expect(sp.verifyWebhook(body, sig.toUpperCase())).toBe(true);
    // Any change to the content fails; formatting-only differences carry the same signed JSON.
    expect(sp.verifyWebhook(body.replace(TRACKER, "track_attacker00000"), sig)).toBe(false);
    expect(sp.verifyWebhook(body.replace("{", "{ "), sig)).toBe(true);
    expect(sp.verifyWebhook(body, sig.slice(0, -2) + "00")).toBe(false);
    expect(sp.verifyWebhook(body, "zz")).toBe(false);
    expect(sp.verifyWebhook(body, null)).toBe(false);
    expect(new Safepay({ ...cfg, webhookSecret: undefined }).verifyWebhook(body, sig)).toBe(false);
  });

  it("also accepts a signature over the compact re-encoded body (as Safepay's WooCommerce plugin computes it)", () => {
    const sp = new Safepay(cfg);
    const pretty = JSON.stringify({ data: { tracker: TRACKER, state: "TRACKER_ENDED" } }, null, 2);
    const compactSig = createHmac("sha512", cfg.webhookSecret).update(JSON.stringify(JSON.parse(pretty))).digest("hex");
    expect(sp.verifyWebhook(pretty, compactSig)).toBe(true);
    expect(sp.verifyWebhook(pretty.replace("TRACKER_ENDED", "TRACKER_STARTED"), compactSig)).toBe(false);
    expect(sp.verifyWebhook("not json", compactSig)).toBe(false);
  });

  it("extracts event type and tracker", () => {
    expect(parseWebhook(body)).toEqual({ type: "payment.succeeded", tracker: TRACKER });
    expect(parseWebhook(JSON.stringify({ type: "x", data: { tracker: { token: TRACKER } } })).tracker).toBe(TRACKER);
    expect(parseWebhook(JSON.stringify({ data: { tracker: "not-a-tracker" } })).tracker).toBeNull();
    expect(parseWebhook("{not json")).toEqual({ type: null, tracker: null });
  });
});

describe("createCheckout", () => {
  it("creates a session for the exact paisa amount and builds the hosted URL", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const body = url.endsWith("/order/payments/v3/") ? { data: { tracker: { token: TRACKER } } } : { data: "tbt-token-0123456789" };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;
    const out = await new Safepay(cfg, fake).createCheckout({
      amountPaisa: 100000,
      orderId: "11111111-1111-1111-1111-111111111111",
      redirectUrl: "https://app.example/billing/return?payment=1",
      cancelUrl: "https://app.example/billing",
    });
    expect(out.tracker).toBe(TRACKER);
    const sent = JSON.parse(String(calls[0]!.init.body));
    expect(sent).toMatchObject({ merchant_api_key: KEY, currency: "PKR", amount: 100000, metadata: { order_id: "11111111-1111-1111-1111-111111111111" } });
    expect((calls[0]!.init.headers as Record<string, string>)["X-SFPY-MERCHANT-SECRET"]).toBe(cfg.secretKey);
    const url = new URL(out.url);
    expect(url.origin + url.pathname).toBe("https://sandbox.api.getsafepay.com/embedded/");
    expect(url.searchParams.get("tracker")).toBe(TRACKER);
    expect(url.searchParams.get("tbt")).toBe("tbt-token-0123456789");
    expect(url.searchParams.get("redirect_url")).toBe("https://app.example/billing/return?payment=1");
  });

  it("refuses bad amounts and redacts secrets from errors", async () => {
    await expect(new Safepay(cfg).createCheckout({ amountPaisa: 0, orderId: "x", redirectUrl: "", cancelUrl: "" })).rejects.toThrow();
    expect(redact('{"secret":"abc","merchant_api_key":"sec_live_abcdef123"} track_abcdef123456')).not.toMatch(/abc"|sec_live|track_abc/);
  });
});
