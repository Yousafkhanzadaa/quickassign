// Single choke point for every OpenAI call, so data-handling rules are enforced once:
//   * store: false  (the Responses API defaults to storing for 30 days; we never want that)
//   * safety_identifier is a keyed hash of the tenant, never an email or name
//   * usage is recorded per tenant for cost tracking
import { createHmac } from "node:crypto";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import type { z } from "zod";
import { costUsd } from "../pricing.js";

export type Effort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface Usage {
  userId: string;
  kind: string;
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export class LlmUnavailableError extends Error {
  constructor() {
    super("AI is not configured (OPENAI_API_KEY missing)");
    this.name = "LlmUnavailableError";
  }
}

export class LlmOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmOutputError";
  }
}

export class Llm {
  readonly #client: OpenAI | null;
  readonly #pepper: Buffer;
  readonly #onUsage: (u: Usage) => Promise<void>;

  constructor(apiKey: string | undefined, pepper: Buffer, onUsage: (u: Usage) => Promise<void>) {
    this.#client = apiKey ? new OpenAI({ apiKey, maxRetries: 3, timeout: 15 * 60_000 }) : null;
    this.#pepper = pepper;
    this.#onUsage = onUsage;
  }

  get enabled(): boolean {
    return this.#client !== null;
  }

  #requireClient(): OpenAI {
    if (!this.#client) throw new LlmUnavailableError();
    return this.#client;
  }

  /** Stable pseudonymous id for OpenAI's abuse monitoring; not reversible to the tenant. */
  safetyId(userId: string): string {
    return createHmac("sha256", this.#pepper).update(userId).digest("hex").slice(0, 32);
  }

  async #record(userId: string, kind: string, model: string, usage: OpenAI.Responses.ResponseUsage | undefined): Promise<void> {
    if (!usage) return;
    const cached = usage.input_tokens_details?.cached_tokens ?? 0;
    await this.#onUsage({
      userId,
      kind,
      model,
      inputTokens: usage.input_tokens,
      cachedInputTokens: cached,
      outputTokens: usage.output_tokens,
      costUsd: costUsd(model, usage.input_tokens, cached, usage.output_tokens),
    });
  }

  /** Structured output validated against a zod schema. */
  async parse<T>(opts: {
    userId: string;
    kind: string;
    model: string;
    effort: Effort;
    instructions: string;
    input: ResponseInputItem[];
    schema: z.ZodType<T>;
    schemaName: string;
    maxOutputTokens: number;
  }): Promise<T> {
    const client = this.#requireClient();
    const resp = await client.responses.parse({
      model: opts.model,
      instructions: opts.instructions,
      input: opts.input,
      store: false,
      reasoning: { effort: opts.effort },
      max_output_tokens: opts.maxOutputTokens,
      safety_identifier: this.safetyId(opts.userId),
      text: { format: zodTextFormat(opts.schema, opts.schemaName) },
    });
    await this.#record(opts.userId, opts.kind, opts.model, resp.usage);
    if (resp.status === "incomplete") throw new LlmOutputError(`incomplete response: ${resp.incomplete_details?.reason ?? "unknown"}`);
    if (resp.output_parsed == null) throw new LlmOutputError("model returned no structured output (possibly a refusal)");
    return resp.output_parsed as T;
  }

  /** Free-form text output. */
  async text(opts: {
    userId: string;
    kind: string;
    model: string;
    effort: Effort;
    instructions: string;
    input: ResponseInputItem[];
    maxOutputTokens: number;
  }): Promise<string> {
    const client = this.#requireClient();
    const resp = await client.responses.create({
      model: opts.model,
      instructions: opts.instructions,
      input: opts.input,
      store: false,
      reasoning: { effort: opts.effort },
      max_output_tokens: opts.maxOutputTokens,
      safety_identifier: this.safetyId(opts.userId),
    });
    await this.#record(opts.userId, opts.kind, opts.model, resp.usage);
    if (resp.status === "incomplete") throw new LlmOutputError(`incomplete response: ${resp.incomplete_details?.reason ?? "unknown"}`);
    const text = resp.output_text?.trim() ?? "";
    if (!text) throw new LlmOutputError("model returned no text (possibly a refusal)");
    return text;
  }

  async embed(userId: string, model: string, inputs: string[]): Promise<number[][]> {
    const client = this.#requireClient();
    const out: number[][] = [];
    for (let i = 0; i < inputs.length; i += 64) {
      const batch = inputs.slice(i, i + 64);
      const resp = await client.embeddings.create({ model, input: batch, encoding_format: "float", dimensions: 1536 });
      const tokens = resp.usage?.prompt_tokens ?? 0;
      await this.#onUsage({ userId, kind: "embed", model, inputTokens: tokens, cachedInputTokens: 0, outputTokens: 0, costUsd: costUsd(model, tokens, 0, 0) });
      for (const d of resp.data.sort((a, b) => a.index - b.index)) out.push(d.embedding);
    }
    return out;
  }
}
