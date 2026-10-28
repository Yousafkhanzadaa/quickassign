import type { Metadata } from "next";
import Link from "next/link";
import { ContactLine, LegalPage } from "@/components/legal";
import { site } from "@/lib/site";

export const metadata: Metadata = { title: "Terms of service", robots: { index: true, follow: true } };

export default function TermsPage() {
  const s = site();
  return (
    <LegalPage title="Terms of service" updated="28 October 2026">
      <p>
        These terms are an agreement between you and {s.legalName} (&quot;QuickAssign&quot;, &quot;we&quot;) for using the QuickAssign
        service. By creating an account you accept them, together with our <Link href="/privacy">privacy policy</Link> and{" "}
        <Link href="/refunds">refund policy</Link>.
      </p>

      <h2>1. The service</h2>
      <p>
        QuickAssign is a private study assistant. With your permission it connects to your WhatsApp account as a linked device, reads
        messages in the class groups you choose, detects assignments and deadlines, reminds you, and, when you ask, prepares a worked
        solution and sends it to your own &quot;Message yourself&quot; chat and your dashboard.
      </p>
      <p>
        QuickAssign never submits work to your teachers, never posts in your groups and never messages anyone but you. You stay in
        control: you choose what is solved, and you decide what, if anything, to hand in.
      </p>

      <h2>2. Who can use it</h2>
      <p>
        You must be at least 18 years old and able to enter into this agreement. You may only link a WhatsApp account that belongs to
        you. Keep your password secret and don&apos;t use it anywhere else. You are responsible for activity on your account.
      </p>

      <h2>3. Academic integrity</h2>
      <ul>
        <li>
          Worked solutions are a learning aid. You are responsible for following your university&apos;s rules and the Higher Education
          Commission&apos;s guidance on AI assistance, including disclosing AI use where required.
        </li>
        <li>QuickAssign does not solve quizzes or exams, and may decline any request it considers an assessment taken under exam conditions.</li>
        <li>
          AI-generated answers can be wrong or incomplete. Check every solution before relying on it. We don&apos;t guarantee any grade or
          result.
        </li>
      </ul>

      <h2>4. WhatsApp</h2>
      <p>
        QuickAssign is not affiliated with, endorsed by or sponsored by WhatsApp or Meta. Linking uses WhatsApp&apos;s linked-devices
        feature through an unofficial connection. WhatsApp may restrict or ban accounts it believes use unofficial software. You accept
        that risk when you link, and we are not responsible for actions WhatsApp takes on your account. You can unlink at any time.
      </p>
      <p>
        <strong>You link at your own risk.</strong> Like WhatsApp Web, a linked device has full access to your account: the keys
        QuickAssign stores could be used to read all your chats and send messages as you. QuickAssign&apos;s code only reads the groups
        you switch on and only messages your own chat, and messages from those groups are processed by our AI provider (see the{" "}
        <Link href="/privacy">privacy policy</Link>). Only link if you trust us with your account.
      </p>

      <h2>5. Plans, credits and payment</h2>
      <ul>
        <li>One credit pays for one worked solution. Tracking, reminders and quiz or exam alerts don&apos;t use credits.</li>
        <li>
          New accounts receive free trial credits once{s.freeCredits > 0 ? ` (currently ${s.freeCredits})` : ""}. Trial credits
          don&apos;t expire and have no cash value.
        </li>
        <li>
          Plans are prepaid in Pakistani rupees through our payment processor, Safepay. A plan&apos;s credits are added after the
          payment is confirmed and are valid for the number of days shown on the plan (currently 30). Unused credits expire at the end of
          that period. Plans never renew automatically.
        </li>
        <li>The price shown at checkout is the amount charged. Prices may change, but never for a plan you have already paid for.</li>
        <li>If a solution can&apos;t be produced, its credit is returned to your balance automatically.</li>
        <li>
          Refunds follow our <Link href="/refunds">refund policy</Link>.
        </li>
      </ul>

      <h2>6. Your content</h2>
      <p>
        You keep all rights to the content you upload or that arrives from your groups. You give us permission to store and process it
        only to provide the service to you. Only upload course materials you are allowed to use for your own study. Solutions made for
        you are yours to use, subject to your university&apos;s rules.
      </p>

      <h2>7. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>link a WhatsApp account that isn&apos;t yours, or use QuickAssign to monitor other people;</li>
        <li>use the service for anything unlawful, or to harass, deceive or harm anyone;</li>
        <li>try to access other students&apos; data, overload the service, or get around credit, rate or safety limits;</li>
        <li>resell or share access to your account.</li>
      </ul>
      <p>
        Security research is welcome. Please report vulnerabilities privately as described in our{" "}
        {s.repoUrl ? <a href={`${s.repoUrl}/blob/main/SECURITY.md`}>security policy</a> : "security policy"}, and don&apos;t access data
        that isn&apos;t yours.
      </p>

      <h2>8. Open source</h2>
      <p>
        The QuickAssign source code is published under its own open-source licence{s.repoUrl ? <>, available <a href={s.repoUrl}>here</a></> : ""}. These
        terms govern your use of the hosted service we operate, not your use of the source code.
      </p>

      <h2>9. Availability and changes</h2>
      <p>
        We work to keep QuickAssign running but can&apos;t promise it will always be available or error-free. WhatsApp changes, outages
        at our providers, or maintenance may interrupt it. We may change or discontinue features; if we stop the service entirely, we
        will refund the unused part of any active paid plan.
      </p>

      <h2>10. Suspension and closing your account</h2>
      <p>
        You can delete your account at any time in Settings. We may suspend or close accounts that break these terms or put other
        students or the service at risk; where reasonable, we&apos;ll tell you why first. Credits on an account closed for breaking these
        terms are not refunded.
      </p>

      <h2>11. Liability</h2>
      <p>
        The service is provided &quot;as is&quot;. To the extent the law allows, we are not liable for indirect or consequential losses,
        including academic penalties, lost marks or actions taken by WhatsApp, and our total liability to you is limited to the amount you
        paid us in the three months before the claim. Nothing in these terms limits rights you have under law that can&apos;t be
        excluded.
      </p>

      <h2>12. Governing law</h2>
      <p>These terms are governed by the laws of Pakistan, and the courts of Pakistan have jurisdiction over any dispute.</p>

      <h2>13. Changes to these terms</h2>
      <p>
        We may update these terms. We&apos;ll change the date above and, for significant changes, tell you in the app before they take
        effect. If you keep using QuickAssign after that, the new terms apply.
      </p>

      <h2>Contact</h2>
      <p>
        {s.legalName}
        {s.contactAddress ? `, ${s.contactAddress}` : ""}. Questions about these terms: <ContactLine email={s.contactEmail} />.
      </p>
    </LegalPage>
  );
}
