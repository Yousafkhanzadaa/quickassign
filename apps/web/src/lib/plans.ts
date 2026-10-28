import "server-only";
import { db } from "./server";

export interface PublicPlan {
  id: string;
  name: string;
  pricePaisa: number;
  solves: number;
  periodDays: number;
}

// Shown only if the database can't be reached. Checkout always charges what app.plans says.
const FALLBACK: PublicPlan[] = [
  { id: "basic", name: "Basic", pricePaisa: 50_000, solves: 10, periodDays: 30 },
  { id: "pro", name: "Pro", pricePaisa: 100_000, solves: 25, periodDays: 30 },
];

let cache: { at: number; plans: PublicPlan[] } | undefined;

/** Active plans for public pages. app.plans is a catalogue, not tenant data, so no RLS scope is needed. */
export async function publicPlans(): Promise<PublicPlan[]> {
  if (cache && Date.now() - cache.at < 60_000) return cache.plans;
  try {
    const rows = await db()
      .selectFrom("app.plans")
      .select(["id", "name", "price_paisa", "solves", "period_days"])
      .where("active", "=", true)
      .orderBy("sort_order")
      .execute();
    const plans = rows.map((r) => ({ id: r.id, name: r.name, pricePaisa: r.price_paisa, solves: r.solves, periodDays: r.period_days }));
    cache = { at: Date.now(), plans };
    return plans;
  } catch {
    return cache?.plans ?? FALLBACK;
  }
}
