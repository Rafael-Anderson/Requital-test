"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Ban, Eye, LogIn, RotateCcw } from "lucide-react";
import {
  listPlatformShops,
  suspendShop,
  unsuspendShop,
  type PlatformShopListItem,
  type ShopStatus,
} from "@/lib/platform-api";
import { confirmSuspend, startImpersonation } from "@/lib/impersonation";

const STATUS_STYLES: Record<ShopStatus, string> = {
  active: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  suspended: "bg-red-500/15 text-red-400 border-red-500/30",
};

// Icon-button treatment mirrors the merchant admin's own row-action
// convention (Table.tsx's doc comment) — translated to this app's dark
// palette rather than the merchant light one.
const ICON_BUTTON =
  "rounded p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100 transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400";

const PAGE_BUTTON =
  "rounded-lg border border-slate-700 bg-slate-900 px-3 py-1 text-xs font-semibold text-slate-200 hover:bg-slate-800 disabled:opacity-40 disabled:hover:bg-slate-900";

const PAGE_SIZE = 20;

export default function PlatformShopsPage() {
  const [shops, setShops] = useState<PlatformShopListItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"" | ShopStatus>("");
  const [busyId, setBusyId] = useState<number | null>(null);

  const refresh = useCallback(() => {
    listPlatformShops({
      q: q || undefined,
      status: status || undefined,
      page,
      pageSize: PAGE_SIZE,
    }).then((result) => {
      setShops(result.data);
      setTotal(result.total);
    });
  }, [q, status, page]);

  // A filter change can leave the current page past the end of the new result
  // set, which would render an empty table with no obvious cause.
  useEffect(() => {
    setPage(1);
  }, [q, status]);

  useEffect(() => {
    const t = setTimeout(refresh, 250);
    return () => clearTimeout(t);
  }, [refresh]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  async function toggleSuspend(shop: PlatformShopListItem) {
    if (shop.status === "active" && !confirmSuspend()) return;
    setBusyId(shop.id);
    try {
      if (shop.status === "active") await suspendShop(shop.id);
      else await unsuspendShop(shop.id);
      refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function impersonate(shop: PlatformShopListItem) {
    setBusyId(shop.id);
    try {
      await startImpersonation(shop.id);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-100">Shops</h1>
        <div className="flex items-center gap-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name or subdomain..."
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
          />
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as "" | ShopStatus)}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-100 focus:border-amber-500 focus:outline-none"
          >
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </select>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-800 text-left text-[11.5px] font-bold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="p-3">Shop</th>
              <th className="p-3">Status</th>
              <th className="p-3">Published</th>
              <th className="p-3">Created</th>
              <th className="p-3">Orders</th>
              <th className="p-3">Last activity</th>
              <th className="p-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {shops?.map((shop) => (
              <tr
                key={shop.id}
                className="border-t border-slate-800 hover:bg-slate-800/50"
              >
                <td className="p-3">
                  <Link
                    href={`/platform/shops/${shop.id}`}
                    className="font-semibold text-slate-100 hover:text-amber-400"
                  >
                    {shop.name}
                  </Link>
                  <div className="text-xs text-slate-500">{shop.subdomain}</div>
                </td>
                <td className="p-3">
                  <span
                    className={`inline-block rounded-full border px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[shop.status]}`}
                  >
                    {shop.status === "active" ? "Active" : "Suspended"}
                  </span>
                </td>
                <td className="p-3 text-slate-300">{shop.published ? "Yes" : "No"}</td>
                <td className="p-3 text-slate-400">
                  {new Date(shop.createdAt).toLocaleDateString()}
                </td>
                <td className="p-3 text-slate-300">{shop.orderCount}</td>
                <td className="p-3 text-slate-400">
                  {new Date(shop.lastActivityAt).toLocaleDateString()}
                </td>
                <td className="p-3">
                  <div className="flex items-center justify-end gap-1">
                    <Link
                      href={`/platform/shops/${shop.id}`}
                      className={ICON_BUTTON}
                      aria-label={`View ${shop.name}`}
                    >
                      <Eye className="size-4" />
                    </Link>
                    <button
                      onClick={() => impersonate(shop)}
                      disabled={busyId === shop.id}
                      className={ICON_BUTTON}
                      aria-label={`Log in as ${shop.name}`}
                      title="Log in as this shop"
                    >
                      <LogIn className="size-4" />
                    </button>
                    <button
                      onClick={() => toggleSuspend(shop)}
                      disabled={busyId === shop.id}
                      className={ICON_BUTTON}
                      aria-label={shop.status === "active" ? `Suspend ${shop.name}` : `Unsuspend ${shop.name}`}
                      title={shop.status === "active" ? "Suspend shop" : "Unsuspend shop"}
                    >
                      {shop.status === "active" ? (
                        <Ban className="size-4" />
                      ) : (
                        <RotateCcw className="size-4" />
                      )}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {shops?.length === 0 && (
          <div className="p-8 text-center text-sm text-slate-500">No shops match.</div>
        )}
      </div>

      {shops !== null && shops.length > 0 && (
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>
            {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
          </span>
          <div className="flex items-center gap-2">
            <button className={PAGE_BUTTON} disabled={page <= 1} onClick={() => setPage((pv) => pv - 1)}>
              Previous
            </button>
            <span>
              Page {page} of {totalPages}
            </span>
            <button
              className={PAGE_BUTTON}
              disabled={page >= totalPages}
              onClick={() => setPage((pv) => pv + 1)}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
