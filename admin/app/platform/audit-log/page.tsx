"use client";

import { useEffect, useState } from "react";
import { listPlatformAuditLog, type PlatformAuditLogEntry } from "@/lib/platform-api";

export default function PlatformAuditLogPage() {
  const [entries, setEntries] = useState<PlatformAuditLogEntry[] | null>(null);

  useEffect(() => {
    listPlatformAuditLog().then(setEntries);
  }, []);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-100">Audit log</h1>
      <p className="text-sm text-slate-500">
        Every platform admin action, impersonation sessions especially — who, what, which shop,
        when.
      </p>

      <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-800 text-left text-[11.5px] font-bold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="p-3">Time</th>
              <th className="p-3">Platform admin</th>
              <th className="p-3">Action</th>
              <th className="p-3">Shop</th>
            </tr>
          </thead>
          <tbody>
            {entries?.map((entry) => (
              <tr key={entry.id} className="border-t border-slate-800">
                <td className="p-3 text-slate-400">{new Date(entry.createdAt).toLocaleString()}</td>
                <td className="p-3 text-slate-300">#{entry.platformAdminId}</td>
                <td className="p-3 font-mono text-slate-200">{entry.action}</td>
                <td className="p-3 text-slate-300">{entry.shopId ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {entries?.length === 0 && (
          <div className="p-8 text-center text-sm text-slate-500">No actions logged yet.</div>
        )}
      </div>
    </div>
  );
}
