// Client for the network-isolated document sandbox (sandbox/).

export interface RenderMeta {
  title: string;
  subtitle?: string;
  university?: string;
  student_name?: string;
  roll_number?: string;
  course?: string;
  instructor?: string;
  due?: string;
  date?: string;
  disclosure?: string;
}

export class SandboxError extends Error {
  constructor(
    readonly code: string,
    readonly detail?: string,
  ) {
    super(`sandbox: ${code}${detail ? `: ${detail}` : ""}`);
    this.name = "SandboxError";
  }
}

export interface ExtractedPage {
  page: number;
  text: string;
}

export class SandboxClient {
  readonly #base: string;
  readonly #token: string;

  constructor(baseUrl: string, token: string) {
    if (token.length < 32) throw new Error("sandbox token must be at least 32 characters");
    this.#base = baseUrl.replace(/\/+$/, "");
    this.#token = token;
  }

  async #post<T>(path: string, body: unknown, timeoutMs: number): Promise<T> {
    const res = await fetch(this.#base + path, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.#token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new SandboxError(String(json.error ?? `http_${res.status}`), typeof json.detail === "string" ? json.detail : undefined);
    return json as T;
  }

  async render(markdown: string, meta: RenderMeta, formats: Array<"pdf" | "docx">): Promise<{ pdf?: Buffer; docx?: Buffer }> {
    const r = await this.#post<{ pdf?: string; docx?: string }>("/render", { markdown, meta, formats }, 4 * 60_000);
    return {
      pdf: r.pdf ? Buffer.from(r.pdf, "base64") : undefined,
      docx: r.docx ? Buffer.from(r.docx, "base64") : undefined,
    };
  }

  async extract(fileName: string, data: Buffer): Promise<{ kind: string; pages: ExtractedPage[]; truncated: boolean }> {
    const r = await this.#post<{ kind: string; pages: ExtractedPage[] | null; truncated: boolean }>(
      "/extract",
      { file_name: fileName, data: data.toString("base64") },
      3 * 60_000,
    );
    return { kind: r.kind, pages: r.pages ?? [], truncated: r.truncated };
  }
}
