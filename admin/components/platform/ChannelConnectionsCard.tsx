"use client";

import { useEffect, useState } from "react";
import {
  listPlatformChannelConnections,
  PlatformApiError,
  unverifyChannelLocation,
  verifyChannelLocation,
  type PlatformChannelConnection,
} from "@/lib/platform-api";
import LoadFailed from "@/components/ui/LoadFailed";
import { useToast } from "@/components/ui/Toast";

// Staff confirm a merchant's marketplace ids with the marketplace's integration
// team, then record it here. The ids are shown read-only and RESTATED to the
// server: if the merchant changed any of them after this page loaded, the server
// verifies nothing (409) and staff reload and look again.
export function confirmUnverify(c: Pick<PlatformChannelConnection, "providerDisplayName" | "outletName">): boolean {
  return window.confirm(
    `Remove the verification of ${c.providerDisplayName}${c.outletName ? ` at ${c.outletName}` : ""}?\n\n` +
      "This also TURNS THE CONNECTION OFF: the shop stops receiving marketplace orders through it until you verify it again and the merchant turns it back on. It is recorded in the audit log.",
  );
}

function IdField({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={`mt-0.5 break-words font-mono text-sm ${value ? "text-slate-100" : "text-slate-500"}`}>{value ?? "Not set"}</dd>
    </div>
  );
}

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : "";
}

function Row({
  shopId,
  c,
  onChanged,
  onReload,
}: {
  shopId: number;
  c: PlatformChannelConnection;
  onChanged: (next: PlatformChannelConnection) => void;
  onReload: () => void;
}) {
  const toast = useToast();
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const verified = c.locationVerifiedAt !== null;

  async function verify() {
    if (!c.externalLocationId) return;
    setBusy(true);
    try {
      // The three ids exactly as shown above: the server matches only if they are
      // still the stored ones.
      const next = await verifyChannelLocation(shopId, c.id, {
        externalLocationId: c.externalLocationId,
        externalBrandId: c.externalBrandId,
        externalSiteId: c.externalSiteId,
      });
      setStale(false);
      setConfirmed(false);
      onChanged(next);
      toast("Location verified");
    } catch (err) {
      if (err instanceof PlatformApiError && err.status === 409) {
        setStale(true);
      } else {
        toast(err instanceof Error ? err.message : "Could not verify the location", "error");
      }
    } finally {
      setBusy(false);
    }
  }

  async function unverify() {
    if (!confirmUnverify(c)) return;
    setBusy(true);
    try {
      onChanged(await unverifyChannelLocation(shopId, c.id));
      toast("Verification removed and the connection turned off");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not remove the verification", "error");
    } finally {
      setBusy(false);
    }
  }

  const label = `${c.providerDisplayName}${c.outletName ? ` at ${c.outletName}` : ""}`;
  return (
    <li aria-label={label} className="space-y-3 rounded-xl border border-slate-800 bg-slate-950 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-slate-100">{label}</h3>
        <span
          className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${
            verified ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-400" : "border-amber-500/30 bg-amber-500/15 text-amber-400"
          }`}
        >
          {verified ? "Verified" : "Not verified"}
        </span>
        <span className="rounded-full border border-slate-600 bg-slate-700/40 px-2 py-0.5 text-xs font-semibold text-slate-300">
          {c.enabled ? "Receiving orders" : "Off"}
        </span>
      </div>

      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <IdField label="Location ID" value={c.externalLocationId} />
        <IdField label="Brand ID" value={c.externalBrandId} />
        <IdField label="Site ID" value={c.externalSiteId} />
      </dl>

      <p className="text-xs text-slate-500">
        {c.verificationRequestedAt && !verified ? `The merchant asked for verification on ${when(c.verificationRequestedAt)}. ` : ""}
        {verified ? `Verified on ${when(c.locationVerifiedAt)} by platform admin #${c.locationVerifiedBy ?? "unknown"}.` : ""}
      </p>

      {stale && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-300">
          <span>The ids changed since you loaded this page, so nothing was verified. Reload and check them again.</span>
          <button
            type="button"
            onClick={() => {
              setStale(false);
              setConfirmed(false);
              onReload();
            }}
            className="rounded-md border border-amber-500/40 px-2 py-1 font-semibold hover:bg-amber-500/10"
          >
            Reload
          </button>
        </div>
      )}

      {verified ? (
        <button
          type="button"
          onClick={() => void unverify()}
          disabled={busy}
          className="rounded-md border border-red-500/40 px-3 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-500/10 disabled:opacity-40"
        >
          {busy ? "Working..." : "Remove verification"}
        </button>
      ) : (
        <div className="space-y-2">
          <label className="flex items-start gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              disabled={!c.externalLocationId}
              className="mt-0.5 size-4 accent-amber-500"
            />
            <span>I confirmed these ids with the marketplace</span>
          </label>
          {!c.externalLocationId && <p className="text-xs text-slate-500">The merchant has not entered a location id yet.</p>}
          <button
            type="button"
            onClick={() => void verify()}
            disabled={busy || !confirmed || !c.externalLocationId}
            className="rounded-md bg-amber-500 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-40"
          >
            {busy ? "Verifying..." : "Verify location"}
          </button>
        </div>
      )}
    </li>
  );
}

export default function ChannelConnectionsCard({ shopId }: { shopId: number }) {
  const [rows, setRows] = useState<PlatformChannelConnection[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    // `stale` drops an answer that arrives after the shop changed or a retry started.
    let stale = false;
    listPlatformChannelConnections(shopId)
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
  }, [shopId, nonce]);

  function reload() {
    setFailed(false);
    setRows(null);
    setNonce((n) => n + 1);
  }

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 lg:col-span-2">
      <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-slate-400">Marketplace connections</h2>
      <p className="mb-3 text-xs text-slate-500">
        A merchant types these ids, so they are only a claim. Confirm them with the marketplace&apos;s integration team before
        you verify. The connection cannot be turned on until it is verified, and changing an id or the credentials clears the
        verification.
      </p>
      {failed ? (
        <LoadFailed what="marketplace connections" onRetry={reload} />
      ) : !rows ? (
        <div role="status" className="text-sm text-slate-500">
          Loading connections...
        </div>
      ) : rows.length === 0 ? (
        <div className="text-sm text-slate-500">This shop has no marketplace connections.</div>
      ) : (
        <ul className="space-y-3">
          {rows.map((c) => (
            <Row
              key={c.id}
              shopId={shopId}
              c={c}
              onReload={reload}
              onChanged={(next) => setRows((list) => (list ?? []).map((x) => (x.id === next.id ? next : x)))}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
