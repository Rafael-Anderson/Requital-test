"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  clearShopFeatureOverride,
  getPlatformShop,
  listShopFeatures,
  setShopFeatureOverride,
  setShopSliderAccountId,
  sliderTestDispatch,
  suspendShop,
  unsuspendShop,
  type PlatformShopDetail,
  type ShopFeatureStatus,
  type SliderQuoteVehicle,
} from "@/lib/platform-api";
import { confirmSuspend, startImpersonation } from "@/lib/impersonation";
import { formatMoney } from "@/lib/money";
import StaffTwoFactorCard from "@/components/platform/StaffTwoFactorCard";

const SLIDER_STATUS_STYLES: Record<string, string> = {
  connected: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  awaiting_setup: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  not_enabled: "bg-slate-700/40 text-slate-400 border-slate-600",
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
      <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-slate-400">{title}</h2>
      {children}
    </div>
  );
}

export default function PlatformShopDetailPage() {
  const params = useParams();
  const shopId = Number(params.shopId);

  const [shop, setShop] = useState<PlatformShopDetail | null>(null);
  const [features, setFeatures] = useState<ShopFeatureStatus[]>([]);
  const [featureNote, setFeatureNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [accountIdInput, setAccountIdInput] = useState("");
  const [dispatchResult, setDispatchResult] = useState<{ vehicles: SliderQuoteVehicle[]; currency: string } | string | null>(
    null,
  );

  const refresh = useCallback(() => {
    getPlatformShop(shopId).then((s) => {
      setShop(s);
      setAccountIdInput(s.integrations.slider.accountId ?? "");
    });
    listShopFeatures(shopId).then(setFeatures);
  }, [shopId]);

  useEffect(() => {
    if (Number.isFinite(shopId)) refresh();
  }, [shopId, refresh]);

  if (!shop) return <div className="text-slate-400">Loading...</div>;

  async function toggleSuspend() {
    // Unsuspend needs no confirmation (reversing a block is low-stakes);
    // suspend does, and confirmSuspend() states plainly what it does.
    if (shop!.status === "active" && !confirmSuspend()) return;
    setBusy(true);
    try {
      const updated = shop!.status === "active" ? await suspendShop(shopId) : await unsuspendShop(shopId);
      setShop(updated);
    } finally {
      setBusy(false);
    }
  }

  async function impersonate() {
    setBusy(true);
    try {
      await startImpersonation(shopId);
    } finally {
      setBusy(false);
    }
  }

  async function changeFeature(key: string, enabled: boolean | null) {
    setBusy(true);
    try {
      setFeatures(
        enabled === null
          ? await clearShopFeatureOverride(shopId, key)
          : await setShopFeatureOverride(shopId, key, enabled, featureNote.trim() || undefined),
      );
    } finally {
      setBusy(false);
    }
  }

  async function saveAccountId(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await setShopSliderAccountId(shopId, accountIdInput);
      refresh();
    } finally {
      setBusy(false);
    }
  }

  async function testDispatch() {
    setBusy(true);
    setDispatchResult(null);
    try {
      const quote = await sliderTestDispatch(shopId);
      setDispatchResult({ vehicles: quote.vehicles, currency: quote.currency });
    } catch (err) {
      setDispatchResult(err instanceof Error ? err.message : "Test dispatch failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/platform/shops" className="text-xs text-slate-500 hover:text-slate-300">
          &larr; Shops
        </Link>
        <div className="mt-1 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-100">{shop.name}</h1>
            <p className="text-sm text-slate-500">{shop.subdomain}</p>
          </div>
          <span
            className={`inline-block rounded-full border px-2.5 py-1 text-xs font-semibold ${
              shop.status === "active"
                ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-400"
                : "border-red-500/30 bg-red-500/15 text-red-400"
            }`}
          >
            {shop.status === "active" ? "Active" : "Suspended"}
          </span>
        </div>
      </div>

      {shop.status === "suspended" && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border-2 border-red-500/40 bg-red-500/10 px-5 py-4">
          <div>
            <p className="font-bold text-red-300">This shop is suspended.</p>
            <p className="text-sm text-red-200/80">
              Merchant login is blocked and the storefront is offline. This is reversible.
            </p>
          </div>
          <button
            onClick={toggleSuspend}
            disabled={busy}
            className="shrink-0 rounded-md bg-red-500 px-4 py-2 text-sm font-bold text-black hover:bg-red-400 disabled:opacity-40"
          >
            Unsuspend shop
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Section title="Overview">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Owner</dt>
              <dd className="text-slate-200">
                {shop.owner ? `${shop.owner.name} · ${shop.owner.email}` : "—"}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Published</dt>
              <dd className="text-slate-200">{shop.published ? "Yes" : "No"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Created</dt>
              <dd className="text-slate-200">{new Date(shop.createdAt).toLocaleDateString()}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Orders</dt>
              <dd className="text-slate-200">{shop.orderCount}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Outlets</dt>
              <dd className="text-slate-200">
                {shop.outlets.map((o) => o.name).join(", ") || "—"}
              </dd>
            </div>
          </dl>
        </Section>

        <Section title="Actions">
          <div className="flex flex-col gap-4">
            <div>
              <button
                onClick={impersonate}
                disabled={busy || !shop.owner}
                className="w-full rounded-md bg-amber-500 px-4 py-2 text-sm font-bold text-black hover:bg-amber-400 disabled:opacity-40"
              >
                Log in as this shop
              </button>
              <p className="mt-1.5 text-xs text-slate-500">
                Opens the merchant admin as this shop&apos;s owner. Your session is logged and
                expires in 1 hour.
              </p>
            </div>
            <div>
              <button
                onClick={toggleSuspend}
                disabled={busy}
                className={`w-full rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-40 ${
                  shop.status === "active"
                    ? "border border-red-500/40 text-red-400 hover:bg-red-500/10"
                    : "border border-slate-700 text-slate-100 hover:bg-slate-800"
                }`}
              >
                {shop.status === "active" ? "Suspend shop" : "Unsuspend shop"}
              </button>
              <p className="mt-1.5 text-xs text-slate-500">
                {shop.status === "active"
                  ? "Blocks merchant login and takes the storefront offline. Reversible."
                  : "Restores merchant login and brings the storefront back online."}
              </p>
            </div>
          </div>
        </Section>

        <Section title="Slider delivery">
          <div className="mb-3 flex items-center gap-2">
            <span
              className={`inline-block rounded-full border px-2 py-0.5 text-xs font-semibold ${SLIDER_STATUS_STYLES[shop.integrations.slider.status]}`}
            >
              {shop.integrations.slider.status.replace("_", " ")}
            </span>
          </div>
          <form onSubmit={saveAccountId} className="flex items-end gap-2">
            <div className="flex-1">
              <label className="mb-1 block text-xs text-slate-500">Slider account id</label>
              <input
                value={accountIdInput}
                onChange={(e) => setAccountIdInput(e.target.value)}
                placeholder="acct_..."
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 focus:border-amber-500 focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={busy || !accountIdInput}
              className="rounded-md border border-slate-700 px-3 py-1.5 text-sm font-semibold text-slate-100 hover:bg-slate-800 disabled:opacity-40"
            >
              Save
            </button>
          </form>
          <button
            onClick={testDispatch}
            disabled={busy || !shop.integrations.slider.accountId}
            className="mt-3 rounded-md border border-slate-700 px-3 py-1.5 text-sm font-semibold text-slate-100 hover:bg-slate-800 disabled:opacity-40"
          >
            Test dispatch
          </button>
          {dispatchResult && (
            <div className="mt-3 rounded-md border border-slate-700 bg-slate-950 p-3 text-xs text-slate-300">
              {typeof dispatchResult === "string" ? (
                dispatchResult
              ) : (
                <ul className="space-y-1">
                  {dispatchResult.vehicles.map((v) => (
                    <li key={v.vehicleType}>
                      {v.vehicleType}: {formatMoney(v.deliveryFee, dispatchResult.currency)} {v.isAvailable ? "" : "(unavailable)"}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Section>

        <Section title="Feature flags">
          <p className="mb-3 text-xs text-slate-500">
            An override beats the merchant&apos;s own setting for this shop only. Clear it to hand
            control back. Every change is written to the audit log.
          </p>
          <input
            value={featureNote}
            onChange={(e) => setFeatureNote(e.target.value)}
            maxLength={500}
            placeholder="Note for the next change (optional)"
            className="mb-3 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 focus:border-amber-500 focus:outline-none"
          />
          <ul className="divide-y divide-slate-800">
            {features.map((f) => (
              <li key={f.key} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <div className="text-sm text-slate-200">{f.description}</div>
                  <div className="text-xs text-slate-500">
                    {f.key} / merchant setting:{" "}
                    {f.columnValue === null ? "none" : f.columnValue ? "on" : "off"}
                    {f.override?.note ? ` / note: ${f.override.note}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${
                      f.effective
                        ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-400"
                        : "border-slate-600 bg-slate-700/40 text-slate-400"
                    }`}
                  >
                    {f.effective ? "On" : "Off"}
                    {f.override ? " (override)" : ""}
                  </span>
                  <button
                    onClick={() => changeFeature(f.key, true)}
                    disabled={busy || f.override?.enabled === true}
                    className="rounded-md border border-slate-700 px-2 py-1 text-xs font-semibold text-slate-100 hover:bg-slate-800 disabled:opacity-40"
                  >
                    Force on
                  </button>
                  <button
                    onClick={() => changeFeature(f.key, false)}
                    disabled={busy || f.override?.enabled === false}
                    className="rounded-md border border-slate-700 px-2 py-1 text-xs font-semibold text-slate-100 hover:bg-slate-800 disabled:opacity-40"
                  >
                    Force off
                  </button>
                  <button
                    onClick={() => changeFeature(f.key, null)}
                    disabled={busy || !f.override}
                    className="rounded-md border border-slate-700 px-2 py-1 text-xs font-semibold text-slate-100 hover:bg-slate-800 disabled:opacity-40"
                  >
                    Clear
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </Section>

        <StaffTwoFactorCard shopId={shopId} />

        <Section title="Payments & messaging">
          <div className="space-y-3 text-sm">
            <div>
              <div className="mb-1 text-slate-500">Payment providers configured</div>
              <div className="text-slate-200">
                {shop.integrations.paymentProviders.length
                  ? shop.integrations.paymentProviders.join(", ")
                  : "None"}
              </div>
            </div>
            <div>
              <div className="mb-1 text-slate-500">WhatsApp Business API</div>
              <div className="text-slate-200">
                {shop.integrations.whatsappConfigured ? "Configured" : "Not configured"}
              </div>
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}
