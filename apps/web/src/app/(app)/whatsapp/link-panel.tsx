"use client";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";
import { startLink, unlinkWhatsApp } from "@/lib/actions/whatsapp";

type PairEvent = { type: "qr" | "pair_code" | "success" | "error" | "timeout"; code?: string; reason?: string };

const REASONS: Record<string, string> = {
  passkey_required: "Your WhatsApp account requires a passkey to link devices, which third-party apps can't provide.",
  pair_code_failed: "WhatsApp didn't accept the number. Check it and try again.",
  pairing_failed: "Linking failed. Please try again.",
  "err-client-outdated": "Our WhatsApp service needs an update. Please try again later.",
};

export function LinkPanel() {
  const router = useRouter();
  const [method, setMethod] = useState<"code" | "qr">("code");
  const [phone, setPhone] = useState("+92 ");
  const [stage, setStage] = useState<"idle" | "starting" | "waiting" | "done">("idle");
  const [code, setCode] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => () => esRef.current?.close(), []);

  async function begin() {
    setError(null);
    setCode(null);
    setQr(null);
    setStage("starting");
    const res = await startLink({ method, phone: method === "code" ? phone : undefined });
    if (!res.ok) {
      setError(res.error ?? "Couldn't start linking.");
      setStage("idle");
      return;
    }
    setStage("waiting");
    const es = new EventSource("/api/whatsapp/events");
    esRef.current = es;
    es.onmessage = async (msg) => {
      const e = JSON.parse(msg.data) as PairEvent;
      if (e.type === "qr" && e.code) setQr(await QRCode.toDataURL(e.code, { margin: 1, width: 280 }));
      else if (e.type === "pair_code" && e.code) setCode(e.code);
      else if (e.type === "success") {
        es.close();
        setStage("done");
        setTimeout(() => router.refresh(), 2500);
      } else if (e.type === "timeout") {
        es.close();
        setError("Linking timed out. Start again when you have your phone ready.");
        setStage("idle");
      } else if (e.type === "error") {
        es.close();
        setError(REASONS[e.reason ?? ""] ?? "Linking failed. Please try again.");
        setStage("idle");
      }
    };
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) setStage((s) => (s === "waiting" ? "idle" : s));
    };
  }

  if (stage === "done") {
    return (
      <div className="card">
        <p className="font-semibold text-brand-700">Linked! Finishing setup…</p>
        <p className="mt-1 text-sm text-slate-600">Next you&apos;ll choose which class groups to watch.</p>
      </div>
    );
  }

  return (
    <div className="card space-y-5">
      <div className="flex gap-2" role="tablist">
        {(["code", "qr"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={method === m}
            onClick={() => setMethod(m)}
            disabled={stage !== "idle"}
            className={method === m ? "btn-primary" : "btn-secondary"}
          >
            {m === "code" ? "Link with phone number" : "Scan QR code"}
          </button>
        ))}
      </div>

      {method === "code" ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">Best if you&apos;re on your phone. You&apos;ll get an 8-character code to enter in WhatsApp.</p>
          <div>
            <label className="label" htmlFor="phone">
              Your WhatsApp number
            </label>
            <input
              id="phone"
              className="input font-mono"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              disabled={stage !== "idle"}
              placeholder="+92 300 1234567"
            />
          </div>
        </div>
      ) : (
        <p className="text-sm text-slate-600">Best on a laptop: scan the code with the phone that has your WhatsApp.</p>
      )}

      {stage === "idle" && (
        <button type="button" className="btn-primary" onClick={begin}>
          {method === "code" ? "Get pairing code" : "Show QR code"}
        </button>
      )}
      {stage === "starting" && <p className="text-sm text-slate-600">Connecting to WhatsApp…</p>}

      {stage === "waiting" && method === "code" && (
        <div className="rounded-xl bg-slate-50 p-4">
          {code ? (
            <>
              <p className="text-sm text-slate-600">Your pairing code</p>
              <p className="mt-1 select-all font-mono text-3xl font-bold tracking-[0.3em]">
                {code.slice(0, 4)}-{code.slice(4)}
              </p>
              <ol className="mt-4 list-decimal space-y-1 pl-5 text-sm text-slate-700">
                <li>Open WhatsApp on your phone.</li>
                <li>Go to Settings (or ⋮ menu) → Linked devices → Link a device.</li>
                <li>Tap &ldquo;Link with phone number instead&rdquo;.</li>
                <li>Enter the code above.</li>
              </ol>
            </>
          ) : (
            <p className="text-sm text-slate-600">Requesting a code…</p>
          )}
        </div>
      )}
      {stage === "waiting" && method === "qr" && (
        <div className="flex flex-col items-center gap-3 rounded-xl bg-slate-50 p-4">
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt="WhatsApp linking QR code" width={280} height={280} className="rounded-lg bg-white p-2" />
          ) : (
            <p className="text-sm text-slate-600">Generating QR code…</p>
          )}
          <p className="text-center text-sm text-slate-700">WhatsApp → Settings → Linked devices → Link a device, then scan.</p>
        </div>
      )}
      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  );
}

export function UnlinkButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <button
        type="button"
        className="btn-secondary"
        disabled={pending}
        onClick={async () => {
          if (!confirm("Unlink WhatsApp? QuickAssign will stop reading your groups and its WhatsApp keys will be destroyed.")) return;
          setPending(true);
          const r = await unlinkWhatsApp();
          setPending(false);
          if (!r.ok) setError(r.error ?? "Couldn't unlink.");
          else router.refresh();
        }}
      >
        {pending ? "Unlinking…" : "Unlink WhatsApp"}
      </button>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
