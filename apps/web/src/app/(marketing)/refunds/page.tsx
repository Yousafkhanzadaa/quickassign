import type { Metadata } from "next";
import Link from "next/link";
import { ContactLine, LegalPage } from "@/components/legal";
import { site } from "@/lib/site";

export const metadata: Metadata = { title: "Refund policy", robots: { index: true, follow: true } };

export default function RefundsPage() {
  const s = site();
  return (
    <LegalPage title="Refund policy" updated="6 October 2026">
      <p>
        QuickAssign plans are one-time prepaid payments in Pakistani rupees, made through Safepay from JazzCash, Easypaisa or bank apps via Raast, or with a
        debit/credit card. There are no subscriptions and nothing renews automatically, so you are never charged without starting a
        checkout yourself.
      </p>

      <h2>Automatic credit returns</h2>
      <p>
        If a worked solution can&apos;t be produced, for example because an assignment file can&apos;t be read, the credit goes back to
        your balance automatically. You don&apos;t need to ask.
      </p>

      <h2>When you get a full refund</h2>
      <ul>
        <li>
          <strong>You paid but your credits weren&apos;t added.</strong> We re-check pending payments with Safepay every few minutes, so
          this usually fixes itself. If it hasn&apos;t after an hour, contact us and we&apos;ll add the credits or refund you in full,
          whichever you prefer.
        </li>
        <li>
          <strong>You were charged twice</strong> for the same purchase. The duplicate is refunded in full.
        </li>
        <li>
          <strong>You change your mind within 7 days</strong> of payment and haven&apos;t used any credits from that plan.
        </li>
      </ul>

      <h2>Partial refunds</h2>
      <p>
        If we discontinue QuickAssign while your plan is active, we refund the unused part of the plan in proportion to the credits you
        haven&apos;t used.
      </p>

      <h2>What isn&apos;t refundable</h2>
      <ul>
        <li>Plans with credits already used, except in the cases above.</li>
        <li>Credits that have expired at the end of their plan period.</li>
        <li>Free trial credits, which have no cash value.</li>
        <li>Plans on accounts closed for breaking our <Link href="/terms">terms of service</Link>.</li>
      </ul>

      <h2>How to ask for a refund</h2>
      <p>
        To ask for a refund, <ContactLine email={s.contactEmail} /> from the email address on your account, with the payment reference shown on the{" "}
        <Link href="/billing">Plans &amp; credits</Link> page, the date and the amount. We reply within 3 business days.
      </p>
      <p>
        Approved refunds go back to the original payment method through Safepay. How long the money takes to reach you depends on your
        bank or wallet provider. When a plan is refunded, its remaining credits are removed from your balance.
      </p>

      <h2>Contact</h2>
      <p>
        {s.legalName}
        {s.contactAddress ? `, ${s.contactAddress}` : ""}. Billing questions: <ContactLine email={s.contactEmail} />.
      </p>
    </LegalPage>
  );
}
