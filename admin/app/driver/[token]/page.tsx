"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  DriverApiError,
  driverDeliver,
  driverFail,
  driverGetRun,
  driverSendCode,
  driverUploadPhoto,
  type DriverRunView,
  type DriverStop,
} from "@/lib/driver-api";

// The driver's own page, reached by a magic link. No account, no admin chrome
// (see RequireAuth and AppChrome for the /driver bypass). It shows only the stops
// of the run the link belongs to and the few actions a driver needs.

const FAIL_REASONS = [
  "Customer not answering",
  "Customer not at the address",
  "Wrong or unreachable address",
  "Customer refused the order",
  "Other",
];

function mapsUrl(address: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

function StopCard({
  token,
  stop,
  requirement,
  onChanged,
}: {
  token: string;
  stop: DriverStop;
  requirement: DriverRunView["run"]["proofRequirement"];
  onChanged: (runCompleted?: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [cash, setCash] = useState("");
  const [failing, setFailing] = useState(false);
  const [reason, setReason] = useState(FAIL_REASONS[0]);
  const [otherReason, setOtherReason] = useState("");

  const needsCash = stop.cod !== null && !stop.cod.alreadyCollected;
  const usesCode = requirement === "otp" || requirement === "photo_or_otp";
  const usesPhoto = requirement === "photo" || requirement === "photo_or_otp";

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await fn();
    } catch (err) {
      if (err instanceof DriverApiError && err.status === 404) {
        onChanged(true);
        return;
      }
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const btn =
    "min-h-11 rounded-lg px-4 text-sm font-semibold disabled:opacity-50 border border-black/15 bg-white text-zinc-900 dark:border-white/20 dark:bg-zinc-800 dark:text-zinc-100";
  const primary = "min-h-11 rounded-lg px-4 text-sm font-semibold disabled:opacity-50 bg-accent text-white";
  const field =
    "min-h-11 w-full rounded-lg border border-black/20 bg-white px-3 text-base text-zinc-900 dark:border-white/20 dark:bg-zinc-800 dark:text-zinc-100";

  return (
    <li className="rounded-2xl border border-black/10 bg-white p-4 dark:border-white/15 dark:bg-zinc-900">
      <div className="flex items-start gap-3">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-semibold text-white">{stop.position}</span>
        <div className="min-w-0 flex-1">
          <div className="text-base font-semibold">
            {stop.customerName} <span className="text-sm font-normal text-zinc-500">#{stop.orderNumber}</span>
          </div>
          <a href={`tel:${stop.customerPhone}`} className="inline-block py-1 text-base font-medium text-accent-text underline">
            {stop.customerPhone}
          </a>
          <p className="text-sm">{stop.address}</p>
          <a href={mapsUrl(stop.address)} target="_blank" rel="noopener noreferrer" className="inline-block py-1 text-sm font-medium text-accent-text underline">
            Open in Maps
          </a>
          {stop.timeSlot && <p className="text-sm text-zinc-600 dark:text-zinc-400">Time: {stop.timeSlot}</p>}
          {stop.deliveryNotes && <p className="text-sm text-zinc-600 dark:text-zinc-400">Notes: {stop.deliveryNotes}</p>}
          {stop.items.length > 0 && <p className="text-sm text-zinc-600 dark:text-zinc-400">{stop.items.join(", ")}</p>}
          {stop.cod && (
            <p className="mt-1 inline-block rounded-lg border-2 border-zinc-900 px-2 py-1 text-sm font-bold dark:border-zinc-100">
              {stop.cod.alreadyCollected ? "Cash already collected" : `Collect ${stop.cod.amount} ${stop.cod.currency}`}
            </p>
          )}
        </div>
      </div>

      {stop.status === "delivered" && <p className="mt-3 text-sm font-semibold text-green-700 dark:text-green-400">Delivered{stop.cashDiscrepancy ? ". The cash amount did not match and was flagged." : ""}</p>}
      {stop.status === "failed" && <p className="mt-3 text-sm font-semibold text-red-700 dark:text-red-400">Not delivered{stop.failureReason ? `: ${stop.failureReason}` : ""}</p>}
      {stop.status === "pending" && stop.orderCancelled && (
        <p className="mt-3 text-sm font-semibold text-red-700 dark:text-red-400">The shop cancelled this order. Do not hand it over.</p>
      )}

      {stop.status === "pending" && stop.deliverable && (
        <div className="mt-3 space-y-3 border-t border-black/10 pt-3 dark:border-white/15">
          {usesPhoto && (
            <div>
              <label className={`${btn} inline-flex cursor-pointer items-center`}>
                {stop.proof.hasPhoto ? "Retake photo" : "Take delivery photo"}
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="sr-only"
                  disabled={busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) void run(async () => { await driverUploadPhoto(token, stop.id, file); setInfo("Photo saved"); onChanged(); });
                  }}
                />
              </label>
              {stop.proof.hasPhoto && <span className="ms-2 text-sm text-green-700 dark:text-green-400">Photo saved</span>}
            </div>
          )}
          {usesCode && (
            <div className="space-y-2">
              <button
                type="button"
                className={btn}
                disabled={busy || stop.proof.codSendsLeft === 0}
                onClick={() =>
                  void run(async () => {
                    const r = await driverSendCode(token, stop.id);
                    setInfo(
                      r.sent.email || r.sent.whatsapp
                        ? `Code sent to the customer (valid ${r.expiresInMinutes} minutes). Ask them to read it to you.`
                        : "The customer could not be reached by message. Use a photo instead.",
                    );
                    onChanged();
                  })
                }
              >
                Send code to customer
              </button>
              <label className="block text-sm font-medium">
                Customer code
                <input
                  className={`${field} mt-1 tracking-widest`}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                />
              </label>
            </div>
          )}
          {needsCash && stop.cod && (
            <label className="block text-sm font-medium">
              Cash collected ({stop.cod.currency})
              <input className={`${field} mt-1`} inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} />
            </label>
          )}
          {error && <p role="alert" className="text-sm font-medium text-red-700 dark:text-red-400">{error}</p>}
          {info && <p className="text-sm text-zinc-700 dark:text-zinc-300">{info}</p>}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={primary}
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const r = await driverDeliver(token, stop.id, {
                    ...(code.length === 6 ? { code } : {}),
                    ...(needsCash ? { cashCollected: cash.trim() } : {}),
                  });
                  onChanged(r.runCompleted);
                })
              }
            >
              Mark delivered
            </button>
            <button type="button" className={btn} disabled={busy} onClick={() => setFailing((f) => !f)}>
              Could not deliver
            </button>
          </div>
          {failing && (
            <div className="space-y-2">
              <select className={field} value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason">
                {FAIL_REASONS.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
              {reason === "Other" && (
                <input className={field} value={otherReason} onChange={(e) => setOtherReason(e.target.value)} placeholder="What happened?" maxLength={200} />
              )}
              <button
                type="button"
                className={btn}
                disabled={busy || (reason === "Other" && otherReason.trim().length < 3)}
                onClick={() =>
                  void run(async () => {
                    const r = await driverFail(token, stop.id, reason === "Other" ? otherReason.trim() : reason);
                    onChanged(r.runCompleted);
                  })
                }
              >
                Confirm not delivered
              </button>
            </div>
          )}
        </div>
      )}
      {stop.status === "pending" && !stop.deliverable && !stop.orderCancelled && (
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">This stop is not ready to be delivered yet.</p>
      )}
    </li>
  );
}

export default function DriverRunPage() {
  const params = useParams<{ token: string }>();
  const token = params.token;
  const [view, setView] = useState<DriverRunView | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "closed" | "failed">("loading");

  const latest = useRef(0);
  const load = useCallback(() => {
    const mine = ++latest.current;
    driverGetRun(token)
      .then((v) => {
        if (mine !== latest.current) return;
        setView(v);
        setState("ready");
      })
      .catch((err) => {
        if (mine !== latest.current) return;
        // 404 is every kind of dead link, on purpose: expired, revoked, finished.
        setState(err instanceof DriverApiError && err.status === 404 ? "closed" : "failed");
      });
  }, [token]);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  const shell = "mx-auto min-h-screen max-w-xl px-4 py-6 text-zinc-900 dark:text-zinc-100";

  if (state === "loading") return <main className={shell}><p>Loading...</p></main>;
  if (state === "closed") {
    return (
      <main className={shell}>
        <h1 className="text-xl font-semibold">This link is no longer active</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">The run may be finished, or the shop closed this link. Ask the shop for a new one if you still have deliveries to make.</p>
      </main>
    );
  }
  if (state === "failed" || !view) {
    return (
      <main className={shell}>
        <p role="alert">Could not load your run.</p>
        <button type="button" className="mt-3 min-h-11 rounded-lg border border-black/20 px-4 text-sm font-semibold" onClick={load}>
          Try again
        </button>
      </main>
    );
  }
  return (
    <main className={shell}>
      <h1 className="text-xl font-semibold">{view.shopName}</h1>
      <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">Hi {view.driverName}, here are your deliveries.</p>
      <ol className="space-y-3">
        {view.stops.map((s) => (
          <StopCard
            key={s.id}
            token={token}
            stop={s}
            requirement={view.run.proofRequirement}
            onChanged={(done) => {
              // The last stop closes the run and kills the link: a refetch would 404.
              if (done) setState("closed");
              else load();
            }}
          />
        ))}
      </ol>
    </main>
  );
}
