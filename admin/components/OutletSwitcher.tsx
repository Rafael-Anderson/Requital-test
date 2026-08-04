"use client";

import { Store } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useOutletFilter } from "@/lib/outlet-context";
import Combobox from "@/components/ui/Combobox";

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
      <div className={`w-40 ${loading ? "pointer-events-none opacity-60" : ""}`}>
        <Combobox
          value={selectedOutletId !== null ? String(selectedOutletId) : ""}
          onChange={(value) => setSelectedOutletId(value ? Number(value) : null)}
          placeholder="All branches"
          options={[{ value: "", label: "All branches" }, ...outlets.map((o) => ({ value: String(o.id), label: o.name }))]}
        />
      </div>
    </div>
  );
}
