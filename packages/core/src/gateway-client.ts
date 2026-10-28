// Client for the gateway's internal API. Requests are HMAC-signed exactly as
// gateway/internal/api/auth.go verifies them.
import { createHash, createHmac, randomBytes } from "node:crypto";
import { assertTenantId } from "./db.js";

export type GatewayService = "web" | "worker";

export function canonicalString(service: string, ts: string, nonce: string, method: string, uri: string, body: Buffer): string {
  const bodyHash = createHash("sha256").update(body).digest("hex");
  return `v1\n${service}\n${ts}\n${nonce}\n${method}\n${uri}\n${bodyHash}`;
}

export function signRequest(secret: string, service: string, ts: string, nonce: string, method: string, uri: string, body: Buffer): string {
  return createHmac("sha256", secret).update(canonicalString(service, ts, nonce, method, uri, body)).digest("hex");
}

export class GatewayError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`gateway ${status}: ${code}`);
    this.name = "GatewayError";
  }
}

export interface GatewayStatus {
  running: boolean;
  linked: boolean;
  connected: boolean;
  pairing: boolean;
}

export class GatewayClient {
  readonly #base: string;
  readonly #service: GatewayService;
  readonly #secret: string;

  constructor(baseUrl: string, service: GatewayService, secret: string) {
    if (secret.length < 32) throw new Error("gateway secret must be at least 32 characters");
    this.#base = baseUrl.replace(/\/+$/, "");
    this.#service = service;
    this.#secret = secret;
  }

  async #request(method: "GET" | "POST" | "DELETE", path: string, body?: unknown, timeoutMs = 30_000): Promise<Response> {
    const payload = body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body));
    const ts = Math.floor(Date.now() / 1000).toString();
    const nonce = randomBytes(16).toString("hex");
    const headers: Record<string, string> = {
      "X-QA-Service": this.#service,
      "X-QA-Timestamp": ts,
      "X-QA-Nonce": nonce,
      "X-QA-Signature": signRequest(this.#secret, this.#service, ts, nonce, method, path, payload),
    };
    if (payload.length > 0) headers["Content-Type"] = "application/json";
    const res = await fetch(this.#base + path, {
      method,
      headers,
      body: payload.length > 0 ? payload : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      let code = "error";
      try {
        code = ((await res.json()) as { error?: string }).error ?? code;
      } catch {
        // non-JSON error body
      }
      throw new GatewayError(res.status, code);
    }
    return res;
  }

  #tenantPath(tenant: string, suffix = ""): string {
    assertTenantId(tenant);
    return `/v1/tenants/${tenant}${suffix}`;
  }

  async startLink(tenant: string, method: "qr" | "code", phone?: string): Promise<void> {
    await this.#request("POST", this.#tenantPath(tenant, "/link"), { method, phone: phone ?? "" });
  }

  /** Server-Sent Events stream of pairing progress; caller pipes it to the browser. */
  async linkEvents(tenant: string): Promise<Response> {
    return this.#request("GET", this.#tenantPath(tenant, "/link/events"), undefined, 5 * 60_000);
  }

  async status(tenant: string): Promise<GatewayStatus> {
    return (await this.#request("GET", this.#tenantPath(tenant, "/status"))).json() as Promise<GatewayStatus>;
  }

  async refreshGroups(tenant: string): Promise<number> {
    const r = (await (await this.#request("POST", this.#tenantPath(tenant, "/groups/refresh"), {}, 60_000)).json()) as { groups: number };
    return r.groups;
  }

  async reloadMonitored(tenant: string): Promise<void> {
    await this.#request("POST", this.#tenantPath(tenant, "/monitored/reload"), {});
  }

  async unlink(tenant: string): Promise<void> {
    await this.#request("DELETE", this.#tenantPath(tenant), {});
  }

  async sendText(tenant: string, text: string): Promise<string> {
    const r = (await (await this.#request("POST", this.#tenantPath(tenant, "/self/text"), { text })).json()) as { wa_message_id: string };
    return r.wa_message_id;
  }

  async sendDocument(tenant: string, doc: { fileName: string; mime: string; caption: string; data: Buffer }): Promise<string> {
    const res = await this.#request(
      "POST",
      this.#tenantPath(tenant, "/self/document"),
      { file_name: doc.fileName, mime: doc.mime, caption: doc.caption, data_b64: doc.data.toString("base64") },
      120_000,
    );
    return ((await res.json()) as { wa_message_id: string }).wa_message_id;
  }

  async fetchMedia(tenant: string, messageId: string): Promise<{ data: Buffer; mime: string }> {
    const res = await this.#request("POST", this.#tenantPath(tenant, "/media/fetch"), { message_id: messageId }, 120_000);
    return { data: Buffer.from(await res.arrayBuffer()), mime: res.headers.get("X-QA-Media-Mime") ?? "application/octet-stream" };
  }
}
