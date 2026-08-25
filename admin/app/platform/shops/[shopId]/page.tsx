"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  getPlatformShop,
  impersonateShop,
  setShopSliderAccountId,
  sliderTestDispatch,
  suspendShop,
  unsuspendShop,
  type PlatformShopDetail,
  type SliderQuoteVehicle,
} from "@/lib/platform-api";
import { setTokens as setMerchantTokens } from "@/lib/api";

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
  const [busy, setBusy] = useState(false);
  const [accountIdInput, setAccountIdInput] = useState("");
  const [dispatchResult, setDispatchResult] = useState<SliderQuoteVehicle[] | string | null>(
    null,
  );

  const refresh = useCallback(() => {
    getPlatformShop(shopId).then((s) => {
      setShop(s);
      setAccountIdInput(s.integrations.slider.accountId ?? "");
    });
  }, [shopId]);

  useEffect(() => {
    if (Number.isFinite(shopId)) refresh();
  }, [shopId, refresh]);

  if (!shop) return <div className="text-slate-400">Loading...</div>;

  async function toggleSuspend() {
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
      const session = await impersonateShop(shopId);
      // Merchant tokens only — see ImpersonationBanner's own comment on why
      // this can't collide with the platform session's own storage key.
      setMerchantTokens({ accessToken: session.accessToken, refreshToken: session.refreshToken ?? "" });
      window.open("/", "_blank");
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
      setDispatchResult(quote.vehicles);
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
            {shop.status}
          </span>
        </div>
      </div>

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
          <div className="flex flex-col gap-3">
            <button
              onClick={toggleSuspend}
              disabled={busy}
              className="rounded-md border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-slate-800 disabled:opacity-40"
            >
              {shop.status === "active" ? "Suspend shop" : "Unsuspend shop"}
            </button>
            <button
              onClick={impersonate}
              disabled={busy || !shop.owner}
              className="rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-black hover:bg-amber-400 disabled:opacity-40"
            >
              Impersonate shop admin
            </button>
            <p className="text-xs text-slate-500">
              Impersonation opens a new tab as this shop&apos;s admin, expires in 1 hour, and is
              audit-logged immediately.
            </p>
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
                  {dispatchResult.map((v) => (
                    <li key={v.vehicleType}>
                      {v.vehicleType}: AED {v.deliveryFee} {v.isAvailable ? "" : "(unavailable)"}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Section>

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
