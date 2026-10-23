"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { listPendingChannelVerifications, type PendingChannelVerification } from "@/lib/platform-api";
import LoadFailed from "@/components/ui/LoadFailed";

// Cross-shop queue: connections a merchant asked staff to verify that nobody has
// verified yet, oldest request first. Each row links to the shop, where the ids
// are checked and verified (ChannelConnectionsCard).
export default function PendingChannelVerifications() {
  const [rows, setRows] = useState<PendingChannelVerification[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let stale = false;
    listPendingChannelVerifications()
      .then((d) => {
        if (stale) return;
        setRows(d);
        setFailed(false);
      })
      .catch(() => {
        if (!stale) setFailed(true);
      });
    return () => {
      stale = true;
    };
  }, [nonce]);

  return (
    <section aria-labelledby="pending-verification" className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
      <h2 id="pending-verification" className="mb-1 text-sm font-bold uppercase tracking-wide text-slate-400">
        Marketplace verification requests
      </h2>
      <p className="mb-3 text-xs text-slate-500">Merchants who asked Requital to verify their marketplace location, oldest first.</p>
      {failed ? (
        <LoadFailed
          what="verification requests"
          onRetry={() => {
            setFailed(false);
            setRows(null);
            setNonce((n) => n + 1);
          }}
        />
      ) : !rows ? (
        <div role="status" className="text-sm text-slate-500">
          Loading requests...
        </div>
      ) : rows.length === 0 ? (
        <div className="text-sm text-slate-500">No requests waiting.</div>
      ) : (
        <ul className="divide-y divide-slate-800">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-sm">
              <Link href={`/platform/shops/${r.shopId}`} className="min-w-0 font-semibold text-slate-100 hover:text-amber-400">
                {r.shopName ?? `Shop ${r.shopId}`}
              </Link>
              <span className="text-slate-400">
                {r.providerDisplayName}
                {r.outletName ? ` at ${r.outletName}` : ""}
              </span>
              <span className="font-mono text-xs text-slate-500">{r.externalLocationId ?? "no location id"}</span>
              <span className="ms-auto text-xs text-slate-500">
                Asked {r.verificationRequestedAt ? new Date(r.verificationRequestedAt).toLocaleString() : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
