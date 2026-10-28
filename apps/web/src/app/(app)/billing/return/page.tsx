import { notFound, redirect } from "next/navigation";

const UUID_PREFIX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * Older return links looked like /billing/return?payment=<id>. Safepay appends
 * "?tracker=…" even to URLs that already have a query, so take only the leading id.
 */
export default async function LegacyPaymentReturn({ searchParams }: { searchParams: Promise<{ payment?: string }> }) {
  const raw = (await searchParams).payment ?? "";
  const id = UUID_PREFIX.exec(raw)?.[0];
  if (!id) notFound();
  redirect(`/billing/return/${id.toLowerCase()}`);
}
