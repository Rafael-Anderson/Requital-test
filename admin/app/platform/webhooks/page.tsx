"use client";

import { useCallback, useEffect, useState } from "react";
import { listPlatformWebhookLog, type PlatformWebhookEvent } from "@/lib/platform-api";

const RESULT_STYLES: Record<string, string> = {
  success: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  duplicate: "bg-slate-700/40 text-slate-400 border-slate-600",
  rejected: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  failed: "bg-red-500/15 text-red-400 border-red-500/30",
};

export default function PlatformWebhooksPage() {
  const [events, setEvents] = useState<PlatformWebhookEvent[] | null>(null);
  const [source, setSource] = useState("");
  const [result, setResult] = useState("");
  const [shopId, setShopId] = useState("");

  const refresh = useCallback(() => {
    listPlatformWebhookLog({
      source: source || undefined,
      result: result || undefined,
      shopId: shopId ? Number(shopId) : undefined,
    }).then(setEvents);
  }, [source, result, shopId]);

  useEffect(() => {
    const t = setTimeout(refresh, 250);
    return () => clearTimeout(t);
  }, [refresh]);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-100">Webhook activity</h1>
      <p className="text-sm text-slate-500">
        Platform-wide, across every shop — the first place to check when a merchant asks
        &quot;why didn&apos;t my order update.&quot;
      </p>

      <div className="flex flex-wrap gap-3">
        <input
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder="Source (slider, stripe, ...)"
          className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
        />
        <input
          value={shopId}
          onChange={(e) => setShopId(e.target.value)}
          placeholder="Shop id"
          className="w-28 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
        />
        <select
          value={result}
          onChange={(e) => setResult(e.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-100 focus:border-amber-500 focus:outline-none"
        >
          <option value="">All results</option>
          <option value="success">Success</option>
          <option value="duplicate">Duplicate</option>
          <option value="rejected">Rejected</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-800 text-left text-[11.5px] font-bold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="p-3">Time</th>
              <th className="p-3">Shop</th>
              <th className="p-3">Source</th>
              <th className="p-3">Event</th>
              <th className="p-3">Result</th>
            </tr>
          </thead>
          <tbody>
            {events?.map((e) => (
              <tr key={e.id} className="border-t border-slate-800">
                <td className="p-3 text-slate-400">{new Date(e.createdAt).toLocaleString()}</td>
                <td className="p-3 text-slate-300">{e.shopId}</td>
                <td className="p-3 text-slate-300">{e.source}</td>
                <td className="p-3 text-slate-300">{e.eventType}</td>
                <td className="p-3">
                  <span
                    className={`inline-block rounded-full border px-2 py-0.5 text-xs font-semibold ${RESULT_STYLES[e.result] ?? ""}`}
                  >
                    {e.result}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {events?.length === 0 && (
          <div className="p-8 text-center text-sm text-slate-500">No webhook activity yet.</div>
        )}
      </div>
    </div>
  );
}
