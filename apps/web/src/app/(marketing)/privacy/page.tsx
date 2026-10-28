import type { Metadata } from "next";
import Link from "next/link";
import { ContactLine, LegalPage } from "@/components/legal";
import { site } from "@/lib/site";

export const metadata: Metadata = { title: "Privacy policy", robots: { index: true, follow: true } };

export default function PrivacyPage() {
  const s = site();
  return (
    <LegalPage title="Privacy policy" updated="28 October 2026">
      <p>
        {s.legalName} (&quot;QuickAssign&quot;, &quot;we&quot;) runs QuickAssign, a private study assistant for university students. This
        policy explains what we collect, why, who processes it, how long we keep it and the choices you have. QuickAssign is open source,
        so you can check what this policy says against the code
        {s.repoUrl ? (
          <>
            {" "}
            at <a href={s.repoUrl}>{s.repoUrl.replace(/^https:\/\//, "")}</a>
          </>
        ) : null}
        .
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Your account:</strong> your name, your email address and a salted hash of your password (we never store the
          password itself), and the details you add for your PDFs (roll number, university, department, programme, semester).
        </li>
        <li>
          <strong>Your WhatsApp link:</strong> the keys WhatsApp creates for a linked device, kept in an encrypted store that belongs to
          your account only, and the names of your WhatsApp groups so you can choose which ones to watch.
        </li>
        <li>
          <strong>Messages from the groups you switch on:</strong> message text, attached files, and the sender&apos;s display name. We
          replace each sender&apos;s phone number with a pseudonymous code; phone numbers are never stored.
        </li>
        <li>
          <strong>Your commands:</strong> messages in your own &quot;Message yourself&quot; chat that start with &quot;qa&quot; or reply
          to one of our messages. Your other personal notes there are ignored.
        </li>
        <li>
          <strong>What you upload and what we create for you:</strong> course materials, assignment files, detected tasks and deadlines,
          and worked solutions.
        </li>
        <li>
          <strong>Payments:</strong> the plan, amount, status and the payment reference from our payment processor. We never receive
          your card number, wallet PIN or bank login.
        </li>
        <li>
          <strong>Security and usage records:</strong> your IP address, held briefly in memory to limit sign-in attempts; a log of
          important account events (for example signing in, linking WhatsApp, buying a plan or deleting your account); and how much AI
          processing your account used.
        </li>
      </ul>

      <h2>What we don&apos;t do</h2>
      <ul>
        <li>
          We don&apos;t read chats you haven&apos;t switched on. Their messages are dropped on arrival. Right after you link, WhatsApp
          sends recent history; we hold it in memory only, for at most 45 minutes, so you can choose your groups, and then discard it.
        </li>
        <li>We never post in your groups, never message anyone but you, and never submit work on your behalf.</li>
        <li>We don&apos;t sell your data, show ads, or use your data to train AI models.</li>
      </ul>

      <h2>How we use it</h2>
      <p>
        We use your data only to run the service you asked for: finding tasks in the groups you chose, reminding you, writing the
        solutions you request, delivering them to your own chat, taking payments, keeping your account secure, and meeting our legal
        obligations. Linking WhatsApp and choosing groups is your decision, and you can undo it at any time.
      </p>

      <h2>Who processes your data</h2>
      <p>We use these providers to run QuickAssign. Each receives only what it needs:</p>
      <ul>
        <li>
          <strong>OpenAI</strong> (United States), for the AI models. It receives messages from the groups you watch (to find tasks), and
          the assignment, its files and relevant excerpts from your course materials when you ask for a solution. Classmates are
          referred to by codes like &quot;S1&quot;, never by name or number. We switch off response storage; OpenAI may keep API data for
          up to 30 days to detect abuse and does not use it to train its models.
        </li>
        <li>
          <strong>Safepay</strong> (Pakistan), to process card payments and Raast payments from JazzCash, Easypaisa and bank apps. Your payment details are
          entered on Safepay&apos;s checkout, not on our site.
        </li>
        <li>
          <strong>Our hosting provider</strong>, which runs our servers and database. Message content, files and solutions are
          encrypted by QuickAssign before they reach the database.
        </li>
        <li>
          <strong>WhatsApp (Meta)</strong>: QuickAssign connects to WhatsApp as a linked device on your account, so WhatsApp processes
          that connection under its own terms and privacy policy.
        </li>
      </ul>
      <p>If we add or change a provider, we&apos;ll update this list before it starts receiving your data.</p>

      <h2>How long we keep it</h2>
      <ul>
        <li>Messages from your groups, and the files attached to them: deleted after 30 days.</li>
        <li>Your commands in &quot;Message yourself&quot;: deleted after 7 days.</li>
        <li>Tasks, solutions and course materials: until you delete them or your account.</li>
        <li>Unfinished checkouts are closed after 3 hours.</li>
        <li>
          Payment records, the credit ledger and security log entries are financial and security records. They&apos;re kept after you
          delete your account, linked only to a random account ID, for as long as the law requires.
        </li>
        <li>Deleted data can remain in encrypted database backups until those backups expire.</li>
      </ul>

      <h2>Security</h2>
      <p>
        Your content is encrypted with a key unique to your account (AES-256-GCM), your WhatsApp link is kept in its own encrypted store,
        and database row-level security separates every student&apos;s data. Untrusted files are processed in an isolated sandbox with
        no network access. The full design is public
        {s.repoUrl ? (
          <>
            {" "}
            in our <a href={`${s.repoUrl}/blob/main/docs/security-architecture.md`}>security architecture</a>
          </>
        ) : null}
        . No system is perfectly secure; if we learn of a breach affecting your data, we will tell you promptly.
      </p>

      <h2>Your choices</h2>
      <ul>
        <li>
          <strong>Unlink WhatsApp</strong> at any time from QuickAssign or from your phone (WhatsApp → Linked devices). Unlinking
          destroys the link&apos;s keys.
        </li>
        <li>
          <strong>Stop watching a group</strong> in <Link href="/groups">Groups</Link>; new messages from it are no longer read.
        </li>
        <li>
          <strong>Correct your details</strong> in <Link href="/settings">Settings</Link>.
        </li>
        <li>
          <strong>Delete your account</strong> in Settings. This removes your login, unlinks WhatsApp, deletes your data and finally
          destroys your encryption key.
        </li>
        <li>
          <strong>Ask for a copy</strong> of your data or ask any privacy question: <ContactLine email={s.contactEmail} />.
        </li>
      </ul>

      <h2>Age</h2>
      <p>QuickAssign is for university students aged 18 or older. We don&apos;t knowingly create accounts for anyone younger.</p>

      <h2>Changes</h2>
      <p>
        If we change this policy, we&apos;ll update the date above. For significant changes we&apos;ll tell you in the app before they
        take effect.
      </p>

      <h2>Contact</h2>
      <p>
        {s.legalName}
        {s.contactAddress ? `, ${s.contactAddress}` : ""}. For privacy questions, <ContactLine email={s.contactEmail} />.
      </p>
    </LegalPage>
  );
}
