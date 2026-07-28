"use client";

import { Store } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useOutletFilter } from "@/lib/outlet-context";

// Admin-only control, hidden entirely (not disabled) for branch accounts —
// per spec, branch users never see a switcher at all. The server ignores a
// spoofed outletId from a branch account regardless of what this renders.
export default function OutletSwitcher() {
  const { user } = useAuth();
  const { outlets, selectedOutletId, setSelectedOutletId, loading } = useOutletFilter();

  if (!user || user.role !== "admin") return null;

  return (
    <div className="flex items-center gap-1.5">
      <Store className="size-4 text-zinc-400" />
      <select
        value={selectedOutletId ?? ""}
        disabled={loading}
        onChange={(e) => setSelectedOutletId(e.target.value ? Number(e.target.value) : null)}
        className="h-8 rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-zinc-900 px-2 text-sm outline-none cursor-pointer transition-shadow focus:border-accent focus:ring-[3px] focus:ring-accent/20"
      >
        <option value="">All branches</option>
        {outlets.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </div>
  );
}
