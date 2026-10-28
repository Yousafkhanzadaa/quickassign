// USD per 1M tokens (OpenAI list prices, Oct 2026). Used for per-tenant cost tracking
// only; billing to students is credit-based. Cached-input rate is an estimate where
// OpenAI hasn't published one; override via code when prices change.
const PRICES: Record<string, { input: number; cachedInput: number; output: number }> = {
  "gpt-6-astra": { input: 10, cachedInput: 1, output: 50 },
  "gpt-6.1-sol": { input: 2, cachedInput: 0.2, output: 10 },
  "gpt-6-sol": { input: 2, cachedInput: 0.2, output: 10 },
  "gpt-6-luna": { input: 0.1, cachedInput: 0.01, output: 0.5 },
  "text-embedding-3-small": { input: 0.02, cachedInput: 0.02, output: 0 },
  "text-embedding-3-large": { input: 0.13, cachedInput: 0.13, output: 0 },
};

export function costUsd(model: string, inputTokens: number, cachedInputTokens: number, outputTokens: number): number {
  const p = PRICES[model];
  if (!p) return 0;
  const uncached = Math.max(0, inputTokens - cachedInputTokens);
  return (uncached * p.input + cachedInputTokens * p.cachedInput + outputTokens * p.output) / 1_000_000;
}
