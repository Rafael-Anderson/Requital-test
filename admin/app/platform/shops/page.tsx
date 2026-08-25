"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  listPlatformShops,
  type PlatformShopListItem,
  type ShopStatus,
} from "@/lib/platform-api";

const STATUS_STYLES: Record<ShopStatus, string> = {
  active: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  suspended: "bg-red-500/15 text-red-400 border-red-500/30",
};

export default function PlatformShopsPage() {
  const [shops, setShops] = useState<PlatformShopListItem[] | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"" | ShopStatus>("");

  const refresh = useCallback(() => {
    listPlatformShops({ q: q || undefined, status: status || undefined }).then(setShops);
  }, [q, status]);

  useEffect(() => {
    const t = setTimeout(refresh, 250);
    return () => clearTimeout(t);
  }, [refresh]);

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
                    {shop.status}
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
              </tr>
            ))}
          </tbody>
        </table>
        {shops?.length === 0 && (
          <div className="p-8 text-center text-sm text-slate-500">No shops match.</div>
        )}
      </div>
    </div>
  );
}
