import { withTenant } from "@qa/core";
import Link from "next/link";
import { formatPk, Notice, PageHeader, WaStatusBadge } from "@/components/ui";
import { db } from "@/lib/server";
import { requireProfile } from "@/lib/session";
import { LinkPanel, UnlinkButton } from "./link-panel";

export const metadata = { title: "WhatsApp" };
export const dynamic = "force-dynamic";

export default async function WhatsAppPage() {
  const { user, profile } = await requireProfile();
  const link = await withTenant(db(), user.id, (trx) => trx.selectFrom("app.wa_links").selectAll().executeTakeFirst());
  const status = link?.status ?? "unlinked";

  return (
    <>
      <PageHeader title="WhatsApp" subtitle="Link your WhatsApp as a linked device, like WhatsApp Web." />
      {status === "linked" ? (
        <div className="card space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <WaStatusBadge status={status} />
            {link?.phone_hint && <span className="font-mono text-sm text-slate-600">{link.phone_hint}</span>}
          </div>
          <p className="text-sm text-slate-600">
            Shows on your phone under Settings → Linked devices as <strong>{link?.device_label ?? "QuickAssign"}</strong>. Linked{" "}
            {formatPk(link?.linked_at, profile.timezone)}.
          </p>
          <p className="text-sm">
            Next: <Link className="link" href="/groups">choose which class groups to watch</Link>.
          </p>
          <UnlinkButton />
        </div>
      ) : (
        <>
          <div className="mb-4">
            <Notice tone="error">
              <strong>Use at your own risk.</strong> Linking works like WhatsApp Web: the keys QuickAssign stores can read all your chats and
              send messages as you, not only the groups you pick. QuickAssign&apos;s code only reads the groups you switch on and only
              messages your own chat, but you are trusting whoever runs this site with your whole account. Messages from the groups you
              switch on are processed by an AI service (OpenAI). WhatsApp may restrict or ban accounts that use unofficial apps. You can
              unlink at any time.
            </Notice>
          </div>
          {(status === "logged_out" || status === "error" || status === "temp_banned") && (
            <div className="mb-4">
              <Notice tone={status === "temp_banned" ? "error" : "warn"}>
                {status === "temp_banned"
                  ? "WhatsApp temporarily restricted your account. Wait for the restriction to end before linking again."
                  : `Your previous link ended${link?.last_error ? ` (${link.last_error})` : ""}. Link again below.`}
              </Notice>
            </div>
          )}
          <LinkPanel />
        </>
      )}

      <section className="mt-6 space-y-2 text-sm text-slate-600">
        <h2 className="font-semibold text-slate-900">What QuickAssign can and can&apos;t do</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Reads messages only in the groups you switch on. Everything else is discarded on arrival, never stored or logged.</li>
          <li>Sends messages only to your own &ldquo;Message yourself&rdquo; chat. It never posts in groups or messages anyone else.</li>
          <li>Never marks messages as read and never shows you as online.</li>
          <li>Your WhatsApp keys are encrypted with a key only our WhatsApp service holds. Unlinking destroys them.</li>
          <li>
            Like any linked device, those keys could read all your chats and send messages as you. Only link if you trust whoever runs
            this site.
          </li>
        </ul>
      </section>
    </>
  );
}
