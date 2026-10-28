/**
 * Fixed-window attempt counters, kept in this process's memory. That's enough for one web
 * instance; when you run several, also limit at the reverse proxy (docs/deployment.md).
 */
export class RateLimiter {
  readonly #hits = new Map<string, { start: number; count: number }>();

  constructor(
    readonly max: number,
    readonly windowMs: number,
    readonly maxKeys = 50_000,
  ) {}

  /** Counts one attempt for key. Returns false once the key is over its limit. */
  take(key: string, now = Date.now()): boolean {
    const hit = this.#hits.get(key);
    if (hit && now - hit.start < this.windowMs) {
      hit.count++;
      return hit.count <= this.max;
    }
    this.#hits.delete(key);
    if (this.#hits.size >= this.maxKeys) this.#prune(now);
    this.#hits.set(key, { start: now, count: 1 });
    return true;
  }

  #prune(now: number): void {
    for (const [key, hit] of this.#hits) {
      if (now - hit.start >= this.windowMs) this.#hits.delete(key);
    }
    // Still full: drop the oldest windows (a Map iterates in insertion order).
    for (const key of this.#hits.keys()) {
      if (this.#hits.size < this.maxKeys) break;
      this.#hits.delete(key);
    }
  }
}
