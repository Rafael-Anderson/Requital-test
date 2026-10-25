"use client";

import { useEffect, useState } from "react";
import { getShopBilling, type PlatformShopBilling } from "@/lib/platform-api";
import LoadFailed from "@/components/ui/LoadFailed";

// PLT-1 first slice: read only. Plans and subscriptions have no write route yet,
// so this card only reports. "No subscription" means the fail-open rule is
// covering the shop (every feature available, never billed).
function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString() : "none";
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-sm text-slate-200">{value}</div>
    </div>
  );
}

export default function BillingCard({ shopId }: { shopId: number }) {
  const [data, setData] = useState<PlatformShopBilling | null>(null);
  const [failed, setFailed] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let stale = false;
    getShopBilling(shopId)
      .then((d) => {
        if (stale) return;
        setData(d);
        setFailed(false);
      })
      .catch(() => {
        if (!stale) setFailed(true);
      });
    return () => {
      stale = true;
    };
  }, [shopId, nonce]);

  function retry() {
    setFailed(false);
    setData(null);
    setNonce((n) => n + 1);
  }

  const sub = data?.subscription;
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 lg:col-span-2">
      <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-slate-400">Billing</h2>
      {failed ? (
        <LoadFailed what="billing" onRetry={retry} />
      ) : !data || !sub ? (
        <div role="status" className="text-sm text-slate-500">
          Loading billing...
        </div>
      ) : (
        <>
          {!sub.hasSubscription && (
            <p className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/15 px-3 py-2 text-xs text-amber-400">
              This shop has no subscription row. Every feature is available and it is never billed.
            </p>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Plan" value={sub.plan ? `${sub.plan.name} (${sub.plan.code})` : "none"} />
            <Field label="Status" value={sub.status ?? "none"} />
            <Field label="Source" value={sub.source ?? "none"} />
            <Field label="Currency / interval" value={`${sub.currency ?? "none"} / ${sub.billingInterval ?? "none"}`} />
            <Field label="Trial ends" value={when(sub.trialEndsAt)} />
            <Field
              label={sub.cancelAtPeriodEnd ? "Ends on" : "Period ends"}
              value={when(sub.currentPeriodEnd)}
            />
            <Field
              label={`Orders in ${data.usage.periodKey}`}
              value={
                sub.plan?.orderSoftCeiling != null
                  ? `${data.usage.used} of ${data.usage.ceiling ?? sub.plan.orderSoftCeiling} (${data.usage.percent ?? 0}%)`
                  : `${data.usage.used} (no ceiling)`
              }
            />
            <Field
              label="Suspension"
              value={
                data.suspension.suspendedAt
                  ? `${data.suspension.reason ?? "unknown reason"} since ${when(data.suspension.suspendedAt)}`
                  : "not suspended"
              }
            />
          </div>
          <h3 className="mb-2 mt-5 text-xs font-bold uppercase tracking-wide text-slate-500">Recent events</h3>
          {data.events.length === 0 ? (
            <div className="text-sm text-slate-500">No events recorded.</div>
          ) : (
            <ul className="divide-y divide-slate-800">
              {data.events.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span className="text-slate-200">
                    {e.reason}: {e.fromStatus ?? "none"} to {e.toStatus} ({e.toPlanCode})
                  </span>
                  <span className="text-xs text-slate-500">
                    {e.actorType} / {when(e.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
