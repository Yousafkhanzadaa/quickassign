import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import {
  IconArrowRight,
  IconBell,
  IconBook,
  IconChat,
  IconCheck,
  IconCode,
  IconEyeOff,
  IconFile,
  IconLock,
  IconMail,
  IconPlus,
  IconQr,
  IconShield,
  IconSparkle,
  IconUsers,
} from "@/components/icons";
import { HeroVisual } from "@/components/marketing/hero-visual";
import { FormatChips, MaterialToAnswer, MiniPdf, NoisyGroup, QuizLock, ReminderTimeline } from "@/components/marketing/visuals";
import { formatPkr } from "@/lib/billing";
import { publicPlans, type PublicPlan } from "@/lib/plans";
import { site } from "@/lib/site";
import { hasSessionCookie } from "@/lib/session-cookie";

export const metadata: Metadata = {
  title: { absolute: "QuickAssign: never miss an assignment from your class WhatsApp groups" },
  description:
    "QuickAssign watches the class WhatsApp groups you choose, catches every assignment and deadline, and sends step-by-step worked solutions to your private chat. Pay with JazzCash or Easypaisa.",
  robots: { index: true, follow: true },
};

const STEPS = [
  {
    icon: IconQr,
    title: "Link your WhatsApp",
    body: "Scan a QR code, just like WhatsApp Web. Your phone stays in charge, and you can unlink any time.",
  },
  {
    icon: IconUsers,
    title: "Choose your class groups",
    body: "Switch on only the groups you want watched and add each course's slides. Every other chat is ignored and never saved.",
  },
  {
    icon: IconChat,
    title: "Get it in your own chat",
    body: "New tasks, date changes and reminders arrive in “Message yourself”. Reply solve and the worked PDF follows.",
  },
] as const;

const SECURITY = [
  {
    icon: IconLock,
    title: "Encrypted for you alone",
    body: "Messages, files and solutions are encrypted (AES-256-GCM) with a key that belongs only to your account. Delete your account and the key is destroyed.",
  },
  {
    icon: IconEyeOff,
    title: "Only the groups you pick",
    body: "Chats you don't switch on are dropped the moment they arrive. Group messages and their files are deleted after 30 days.",
  },
  {
    icon: IconChat,
    title: "It can only message you",
    body: "The code that sends WhatsApp messages can only address your own chat, and a test fails the build if anything else tries to send.",
  },
  {
    icon: IconShield,
    title: "Walls between students",
    body: "Row-level security in the database keeps every student's data separate, even if a bug forgets a filter.",
  },
  {
    icon: IconSparkle,
    title: "Payments we never touch",
    body: "JazzCash, Easypaisa and card payments happen on Safepay's checkout. Every payment is confirmed server-to-server before credits are added.",
  },
  {
    icon: IconBook,
    title: "AI that doesn't keep your work",
    body: "Solutions are generated through OpenAI's API with storage switched off. API data isn't used to train OpenAI's models.",
  },
] as const;

const CHECKS = [
  ["gateway", "TestSendsOnlyToOwnChat"],
  ["gateway", "TestOnlyOutboundSends"],
  ["gateway", "TestStoreIsEncryptedAtRest"],
  ["sandbox", "TestCheckMathRejectsDangerous"],
  ["database", "every app table has row-level security enabled and forced"],
  ["database", "student B sees none of A's payments"],
  ["database", "an underpayment is not fulfilled"],
  ["browser", "no CSP violations or page errors"],
] as const;

function faq(freeCredits: number): Array<[string, string]> {
  return [
    [
      "Is this cheating?",
      "QuickAssign is a study aid. Every solution explains each step so you can understand it and write your own answer, and it never submits anything for you. Quizzes and exams are never solved. Your university's rules on AI help still apply: if they ask you to disclose AI assistance, do so. Each PDF carries a short disclosure note to make that easy.",
    ],
    [
      "Will it post in my class group or message my teacher?",
      "No. QuickAssign only ever sends messages to your own “Message yourself” chat. The code that sends messages can't address anyone else, and an automated test blocks any change that tries. It also never marks messages as read or shows you as online.",
    ],
    [
      "Is linking my WhatsApp safe?",
      "Use it at your own risk. Linking works like WhatsApp Web: a linked device can read all your chats and send messages as you. QuickAssign's code only reads the groups you switch on and only messages your own chat, but you are trusting whoever runs this site with your whole account, and messages from your chosen groups are processed by an AI service. QuickAssign is not an official WhatsApp product, and WhatsApp can restrict or ban accounts it believes use unofficial apps. You can remove the link from your phone at any time.",
    ],
    [
      "What can QuickAssign see, and how long is it kept?",
      "Only messages in the class groups you switch on, plus your own commands in “Message yourself”. Messages from every other chat are dropped on arrival. Group messages and their files are deleted after 30 days. Everything is encrypted with a key unique to your account. Your solutions and course materials stay until you delete them or your account.",
    ],
    [
      "How do I pay?",
      "From your JazzCash, Easypaisa or bank app through Raast (scan the QR code or approve the payment request in your app), or with a debit/credit card, on Safepay's secure checkout. You pay once for 30 days; nothing renews automatically. We never see your card number or wallet PIN.",
    ],
    [
      "What happens when my credits run out or my plan ends?",
      `Tracking and reminders keep working for free. Buy another plan whenever you need more solutions. Plan credits are valid for 30 days from payment${freeCredits > 0 ? " and free trial credits don't expire" : ""}. The credits that expire soonest are always used first.`,
    ],
    [
      "What if a solution fails?",
      "If we can't produce a solution, for example because the assignment file can't be read, the credit goes back to your balance automatically.",
    ],
    [
      "Can I get a refund?",
      "Yes: within 7 days of payment if you haven't used any credits from that plan, and always for duplicate charges or payments that didn't add credits. The refund policy has the details.",
    ],
    [
      "Can I delete my data?",
      "Yes. Settings → Delete account removes your login, unlinks WhatsApp and destroys its keys, then deletes your data and your encryption key. Payment records are kept, without your name or messages, because accounting rules require it.",
    ],
  ];
}

export default async function LandingPage() {
  const signedIn = Boolean(hasSessionCookie((await cookies()).getAll()));
  const s = site();
  const plans = await publicPlans();
  const perSolve = (p: PublicPlan) => p.pricePaisa / p.solves;
  const best = plans.length > 1 ? plans.reduce((a, b) => (perSolve(b) < perSolve(a) ? b : a)) : undefined;
  const cheapest = plans.length ? plans.reduce((a, b) => (perSolve(b) < perSolve(a) ? b : a)) : undefined;
  const planHref = (id: string) => (signedIn ? `/billing?plan=${id}` : `/sign-up?plan=${id}`);
  const startHref = signedIn ? "/dashboard" : "/sign-up";
  const startLabel = signedIn ? "Open dashboard" : s.freeCredits > 0 ? `Start free with ${s.freeCredits} solutions` : "Create your account";

  return (
    <>
      {/* Hero */}
      <section className="relative isolate overflow-hidden">
        <div className="bg-grid fade-radial absolute inset-0 -z-10" aria-hidden="true" />
        <div
          className="absolute top-[-14rem] left-1/2 -z-10 h-[34rem] w-[62rem] -translate-x-1/2 rounded-full bg-gradient-to-r from-brand-200/60 via-emerald-100/50 to-sky-200/50 blur-3xl"
          aria-hidden="true"
        />
        <div className="mx-auto grid max-w-6xl items-center gap-16 px-5 pt-12 pb-20 sm:pt-20 lg:grid-cols-[1.08fr_1fr] lg:gap-8 lg:pt-24 lg:pb-28">
          <div className="motion-safe:animate-rise">
            <Link
              href="/#security"
              className="group inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/80 py-1 pr-3 pl-1 text-xs font-medium text-slate-700 shadow-sm backdrop-blur hover:border-slate-300"
            >
              <span className="rounded-full bg-ink-950 px-2 py-0.5 font-semibold whitespace-nowrap text-white">Open source</span>
              <span className="hidden sm:inline">Encrypted per student · never posts in your groups</span>
              <span className="sm:hidden">Encrypted · never posts in groups</span>
              <IconArrowRight className="size-3.5 text-slate-400 transition group-hover:translate-x-0.5" />
            </Link>
            <h1 className="mt-6 font-display text-[2.7rem] leading-[1.02] font-bold tracking-[-0.03em] text-slate-950 sm:text-6xl lg:text-[4.3rem]">
              Never miss an{" "}
              <span className="relative whitespace-nowrap text-brand-700">
                assignment
                <svg
                  aria-hidden="true"
                  viewBox="0 0 300 16"
                  preserveAspectRatio="none"
                  className="absolute -bottom-1.5 left-0 h-3 w-full fill-none stroke-brand-400 sm:-bottom-2"
                >
                  <path d="M3 11c55-7 135-10 294-4" strokeWidth="6" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                </svg>
              </span>{" "}
              again.
            </h1>
            <p className="mt-7 max-w-xl text-lg leading-relaxed text-slate-600">
              QuickAssign quietly watches the WhatsApp class groups you choose, catches every assignment and deadline, and sends a
              step-by-step worked solution, built from your own course slides, to your private chat. You review it, learn from it, and
              submit your own work.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link href={startHref} className="btn-primary h-12 px-6 text-base shadow-lg shadow-brand-700/25">
                {startLabel}
                <IconArrowRight className="size-4" />
              </Link>
              <Link href="/#how-it-works" className="btn-ghost h-12 px-5 text-base">
                See how it works
              </Link>
            </div>
            <dl className="mt-12 grid max-w-lg grid-cols-3 gap-5 border-t border-slate-200/80 pt-6">
              <div>
                <dt className="sr-only">Messages posted to your groups</dt>
                <dd className="font-display text-2xl font-bold text-slate-950">0</dd>
                <dd className="mt-0.5 text-xs leading-snug text-slate-500">messages ever posted to your groups</dd>
              </div>
              <div>
                <dt className="sr-only">Reminders</dt>
                <dd className="font-display text-2xl font-bold text-slate-950">24h · 3h</dd>
                <dd className="mt-0.5 text-xs leading-snug text-slate-500">reminders before every deadline</dd>
              </div>
              {cheapest && (
                <div>
                  <dt className="sr-only">Lowest price per solution</dt>
                  <dd className="font-display text-2xl font-bold text-slate-950">{formatPkr(Math.round(perSolve(cheapest)))}</dd>
                  <dd className="mt-0.5 text-xs leading-snug text-slate-500">per worked solution on {cheapest.name}</dd>
                </div>
              )}
            </dl>
          </div>
          <HeroVisual />
        </div>
      </section>

      {/* Payment methods */}
      <section className="border-y border-slate-200/80 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-3 gap-y-3 px-5 py-6 text-sm">
          <span className="mr-2 font-medium text-slate-500">Pay your way</span>
          {["JazzCash", "Easypaisa", "Raast", "Visa", "Mastercard"].map((m) => (
            <span key={m} className="rounded-full border border-slate-200 bg-slate-50 px-3.5 py-1.5 font-semibold text-slate-700">
              {m}
            </span>
          ))}
          <span className="ml-2 flex items-center gap-1.5 text-slate-500">
            <IconLock className="size-4" /> secured by Safepay
          </span>
        </div>
      </section>

      {/* Problem */}
      <section className="py-24 sm:py-28">
        <div className="mx-auto grid max-w-6xl items-center gap-16 px-5 lg:grid-cols-2">
          <div>
            <p className="eyebrow">The problem</p>
            <h2 className="mt-3 font-display text-4xl font-bold tracking-tight text-balance text-slate-950 sm:text-5xl">
              312 unread messages. One of them is due Friday.
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-slate-600">
              Class groups are loud: memes, “kal class hogi?”, attendance, voice notes. The assignment your teacher posted at 11 PM gets
              buried. QuickAssign reads only the groups you switch on, ignores the chatter and pulls out what matters: the task, the
              deadline and the files.
            </p>
            <ul className="mt-7 space-y-3 text-slate-700">
              {[
                "Understands English and Roman Urdu",
                "Notices when a teacher moves a deadline",
                "Never mixes up quizzes with assignments",
              ].map((t) => (
                <li key={t} className="flex items-center gap-3">
                  <span className="grid size-6 place-items-center rounded-full bg-brand-100 text-brand-700">
                    <IconCheck className="size-3.5" />
                  </span>
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="pb-10">
            <NoisyGroup />
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="scroll-mt-20 bg-slate-50 py-24 sm:py-28">
        <div className="mx-auto max-w-6xl px-5">
          <SectionHeading eyebrow="How it works" title="Set up in about three minutes" />
          <ol className="relative mt-16 grid gap-6 md:grid-cols-3">
            <span className="absolute top-7 right-[16%] left-[16%] hidden h-px border-t-2 border-dashed border-slate-300 md:block" aria-hidden="true" />
            {STEPS.map((step, i) => (
              <li key={step.title} className="relative text-center">
                <span className="relative mx-auto grid size-14 place-items-center rounded-2xl bg-white text-brand-700 shadow-md ring-1 shadow-slate-900/5 ring-slate-200">
                  <step.icon className="size-6" />
                  <span className="absolute -top-2 -right-2 grid size-6 place-items-center rounded-full bg-ink-950 text-xs font-bold text-white">
                    {i + 1}
                  </span>
                </span>
                <h3 className="mt-6 font-display text-xl font-semibold text-slate-950">{step.title}</h3>
                <p className="mx-auto mt-2 max-w-xs leading-relaxed text-slate-600">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="scroll-mt-20 py-24 sm:py-28">
        <div className="mx-auto max-w-6xl px-5">
          <SectionHeading eyebrow="Features" title="Built for how your classes actually run" />
          <div className="mt-16 grid gap-5 lg:grid-cols-3">
            <FeatureCard
              className="lg:col-span-2"
              icon={IconBook}
              title="Answers built from your own course"
              body="Upload the syllabus, slides and notes for each course. Solutions follow your teacher's notation and cite the exact slide they rely on."
            >
              <MaterialToAnswer />
            </FeatureCard>
            <FeatureCard
              icon={IconFile}
              title="Reads however it's posted"
              body="Text, photos of the board, PDFs, Word files and slides, in English or Roman Urdu."
            >
              <FormatChips />
            </FeatureCard>
            <FeatureCard icon={IconBell} title="Reminders before every deadline" body="Twice before each deadline, and a heads-up when a date changes.">
              <ReminderTimeline />
            </FeatureCard>
            <FeatureCard
              icon={IconSparkle}
              title="Ready to hand in, ready to edit"
              body="Your name, roll number and course on top, clean equations and tables, plus an editable Word copy."
            >
              <MiniPdf />
            </FeatureCard>
            <FeatureCard icon={IconLock} title="Quizzes stay yours" body="Quizzes and exams are reminded, never solved. The database itself refuses.">
              <QuizLock />
            </FeatureCard>
          </div>
        </div>
      </section>

      {/* Integrity */}
      <section className="pb-24 sm:pb-28">
        <div className="mx-auto max-w-6xl px-5">
          <div className="grid items-center gap-10 overflow-hidden rounded-3xl border border-brand-100 bg-gradient-to-br from-brand-50 via-white to-white p-8 sm:p-12 lg:grid-cols-2">
            <div>
              <p className="eyebrow">Your work, your call</p>
              <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">A study assistant, not a submission machine</h2>
              <p className="mt-4 leading-relaxed text-slate-600">
                QuickAssign never submits anything for you and never posts in your groups. You decide which assignments to solve, you read
                the solution, and you hand in your own work. Every PDF ends with a short AI-assistance note, so disclosing it is easy when
                your university asks.
              </p>
            </div>
            <ul className="grid gap-3 sm:grid-cols-2">
              {["Solves only what you ask for", "Never submits to your teacher", "Never posts in class groups", "Quizzes and exams: reminders only"].map(
                (t) => (
                  <li key={t} className="flex items-start gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 text-sm font-semibold text-slate-800 shadow-sm">
                    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-600 text-white">
                      <IconCheck className="size-3.5" />
                    </span>
                    {t}
                  </li>
                ),
              )}
            </ul>
          </div>
        </div>
      </section>

      {/* Security */}
      <section id="security" className="relative isolate scroll-mt-20 overflow-hidden bg-ink-950 py-24 text-white sm:py-28">
        <div className="bg-dots fade-radial absolute inset-0 -z-10" aria-hidden="true" />
        <div className="absolute -top-40 right-[-10rem] -z-10 size-[36rem] rounded-full bg-brand-600/25 blur-3xl" aria-hidden="true" />
        <div className="mx-auto max-w-6xl px-5">
          <div className="grid items-start gap-12 lg:grid-cols-[1.05fr_1fr]">
            <div>
              <p className="text-xs font-bold tracking-[0.14em] text-brand-400 uppercase">Security</p>
              <h2 className="mt-3 font-display text-4xl font-bold tracking-tight text-balance sm:text-5xl">
                Open source, so you don&apos;t have to take our word for it
              </h2>
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-slate-300">
                You&apos;re trusting us with your WhatsApp. So every line of QuickAssign is public: anyone can check how your data is
                handled, and security researchers can report problems privately.
              </p>
              {s.repoUrl && (
                <div className="mt-8 flex flex-wrap gap-3">
                  <a href={s.repoUrl} className="btn bg-white text-ink-950 hover:bg-slate-100" rel="noopener noreferrer">
                    <IconCode className="size-4" />
                    Read the source code
                  </a>
                  <a
                    href={`${s.repoUrl}/blob/main/docs/security-architecture.md`}
                    className="btn border border-white/15 text-white hover:bg-white/10"
                    rel="noopener noreferrer"
                  >
                    Security design
                  </a>
                  <a href={`${s.repoUrl}/blob/main/SECURITY.md`} className="btn border border-white/15 text-white hover:bg-white/10" rel="noopener noreferrer">
                    Report a vulnerability
                  </a>
                </div>
              )}
            </div>
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-ink-900/80 shadow-2xl shadow-black/40 backdrop-blur">
              <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
                <span className="size-2.5 rounded-full bg-red-400/80" />
                <span className="size-2.5 rounded-full bg-amber-400/80" />
                <span className="size-2.5 rounded-full bg-brand-400/80" />
                <span className="ml-2 text-xs font-medium text-slate-400">Checked automatically on every change</span>
              </div>
              <ul className="space-y-2.5 p-5 font-mono text-[12.5px] leading-snug">
                {CHECKS.map(([area, name]) => (
                  <li key={name} className="flex gap-3">
                    <span className="text-brand-400">✓</span>
                    <span className="min-w-0 flex-1 text-slate-200">{name}</span>
                    <span className="hidden text-slate-500 sm:inline">{area}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="mt-16 grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 sm:grid-cols-2 lg:grid-cols-3">
            {SECURITY.map((item) => (
              <div key={item.title} className="bg-ink-950/90 p-6">
                <item.icon className="size-6 text-brand-400" />
                <h3 className="mt-4 font-semibold">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="scroll-mt-20 py-24 sm:py-28">
        <div className="mx-auto max-w-6xl px-5">
          <SectionHeading
            eyebrow="Pricing"
            title="Simple prepaid plans"
            body="Pay once for 30 days. No subscription, nothing renews automatically. Tracking and reminders are free on every plan."
          />
          <div className={`mx-auto mt-16 grid max-w-5xl items-stretch gap-6 ${s.freeCredits > 0 ? "lg:grid-cols-3" : "md:grid-cols-2"}`}>
            {s.freeCredits > 0 && (
              <PriceCard
                name="Free trial"
                price="PKR 0"
                period="once"
                note="Try it on your next assignment"
                lines={[`${s.freeCredits} worked solutions to try`, "Unlimited tracking & reminders", "Trial credits never expire", "No card or wallet needed"]}
                cta={signedIn ? "Open dashboard" : "Start free"}
                href={startHref}
              />
            )}
            {plans.map((p) => (
              <PriceCard
                key={p.id}
                name={p.name}
                price={formatPkr(p.pricePaisa)}
                period={`${p.periodDays} days`}
                note={`${formatPkr(Math.round(perSolve(p)))} per solution`}
                lines={[`${p.solves} worked solutions`, "PDF + editable Word for each", "Unlimited tracking & reminders", "No auto-renewal"]}
                cta={`Choose ${p.name}`}
                href={planHref(p.id)}
                featured={best?.id === p.id}
              />
            ))}
          </div>
          <p className="mx-auto mt-8 max-w-3xl text-center text-sm leading-relaxed text-slate-500">
            One credit = one worked solution. If a solution fails, its credit is returned automatically. Pay from JazzCash, Easypaisa or
            any bank app through Raast, or by card, on Safepay&apos;s checkout. See the{" "}
            <Link href="/refunds" className="link">
              refund policy
            </Link>
            .
          </p>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="scroll-mt-20 bg-slate-50 py-24 sm:py-28">
        <div className="mx-auto grid max-w-6xl gap-12 px-5 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <p className="eyebrow">FAQ</p>
            <h2 className="mt-3 font-display text-4xl font-bold tracking-tight text-slate-950">Questions students ask</h2>
            <p className="mt-4 leading-relaxed text-slate-600">Straight answers about privacy, WhatsApp, payments and academic integrity.</p>
            {s.contactEmail && (
              <a
                href={`mailto:${s.contactEmail}`}
                className="mt-8 flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:border-slate-300"
              >
                <span className="grid size-10 place-items-center rounded-xl bg-brand-50 text-brand-700">
                  <IconMail className="size-5" />
                </span>
                <span>
                  <span className="block text-sm font-semibold text-slate-900">Still have a question?</span>
                  <span className="block text-sm text-slate-500">{s.contactEmail}</span>
                </span>
              </a>
            )}
          </div>
          <div className="divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white shadow-sm">
            {faq(s.freeCredits).map(([q, a]) => (
              <details key={q} className="group px-6 py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 font-semibold text-slate-900 [&::-webkit-details-marker]:hidden">
                  {q}
                  <IconPlus className="size-5 shrink-0 text-slate-400 transition group-open:rotate-45" />
                </summary>
                <p className="mt-3 leading-relaxed text-slate-600">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Final call to action */}
      <section className="py-24 sm:py-28">
        <div className="mx-auto max-w-6xl px-5">
          <div className="relative isolate overflow-hidden rounded-[2rem] bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900 px-6 py-16 text-center text-white shadow-2xl shadow-brand-900/20 sm:px-16">
            <div className="bg-dots fade-radial absolute inset-0 -z-10" aria-hidden="true" />
            <h2 className="mx-auto max-w-2xl font-display text-4xl font-bold tracking-tight text-balance sm:text-5xl">Your class groups, sorted.</h2>
            <p className="mx-auto mt-4 max-w-xl text-lg text-brand-100">
              Link your WhatsApp, pick your groups and let QuickAssign keep track. Start with free solutions, no payment needed.
            </p>
            <Link href={startHref} className="btn mt-9 h-12 bg-white px-7 text-base text-brand-800 shadow-lg hover:bg-brand-50">
              {signedIn ? "Open dashboard" : "Create your free account"}
              <IconArrowRight className="size-4" />
            </Link>
            <p className="mt-4 text-sm text-brand-200">No card needed · Unlink any time</p>
          </div>
        </div>
      </section>
    </>
  );
}

function SectionHeading({ eyebrow, title, body }: { eyebrow: string; title: string; body?: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="eyebrow">{eyebrow}</p>
      <h2 className="mt-3 font-display text-4xl font-bold tracking-tight text-balance text-slate-950 sm:text-5xl">{title}</h2>
      {body && <p className="mt-5 text-lg leading-relaxed text-slate-600">{body}</p>}
    </div>
  );
}

function FeatureCard(props: {
  icon: (p: { className?: string }) => React.ReactNode;
  title: string;
  body: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`flex flex-col overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-sm ${props.className ?? ""}`}>
      <div className="p-7 pb-0">
        <span className="grid size-10 place-items-center rounded-xl bg-brand-50 text-brand-700 ring-1 ring-brand-100">
          <props.icon className="size-5" />
        </span>
        <h3 className="mt-5 font-display text-xl font-semibold text-slate-950">{props.title}</h3>
        <p className="mt-2 leading-relaxed text-slate-600">{props.body}</p>
      </div>
      <div className="mt-6 flex flex-1 items-center bg-gradient-to-b from-white to-slate-50 p-7 pt-2">
        <div className="w-full">{props.children}</div>
      </div>
    </div>
  );
}

function PriceCard(props: {
  name: string;
  price: string;
  period: string;
  note?: string;
  lines: string[];
  cta: string;
  href: string;
  featured?: boolean;
}) {
  const dark = props.featured;
  return (
    <div
      className={`relative flex flex-col rounded-3xl p-7 ${
        dark ? "bg-ink-950 text-white shadow-2xl shadow-brand-900/25 ring-1 ring-ink-800 lg:-my-3 lg:py-10" : "border border-slate-200 bg-white shadow-sm"
      }`}
    >
      {dark && (
        <span className="absolute -top-3 left-7 rounded-full bg-brand-500 px-3 py-1 text-xs font-bold text-ink-950 shadow">Best value</span>
      )}
      <h3 className={`font-display text-lg font-semibold ${dark ? "text-white" : "text-slate-950"}`}>{props.name}</h3>
      <p className="mt-4 flex items-baseline gap-1.5">
        <span className={`font-display text-4xl font-bold tracking-tight ${dark ? "text-white" : "text-slate-950"}`}>{props.price}</span>
        <span className={`text-sm ${dark ? "text-slate-400" : "text-slate-500"}`}>/ {props.period}</span>
      </p>
      <p className={`mt-1.5 text-sm font-medium ${dark ? "text-brand-400" : "text-brand-700"}`}>{props.note}</p>
      <ul className={`mt-6 flex-1 space-y-3 text-sm ${dark ? "text-slate-200" : "text-slate-700"}`}>
        {props.lines.map((l) => (
          <li key={l} className="flex items-start gap-2.5">
            <IconCheck className={`mt-0.5 size-4 shrink-0 ${dark ? "text-brand-400" : "text-brand-600"}`} />
            {l}
          </li>
        ))}
      </ul>
      <Link
        href={props.href}
        className={`mt-8 w-full ${dark ? "btn bg-brand-500 text-ink-950 hover:bg-brand-400" : "btn-secondary"} h-11`}
      >
        {props.cta}
      </Link>
    </div>
  );
}
