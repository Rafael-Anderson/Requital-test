"use client";

import { Info, MapPin, Truck, Package, QrCode } from "lucide-react";
import Toggle from "@/components/ui/Toggle";

export type OutletEditTab = "basic" | "address" | "delivery" | "pickup" | "qr";

const TABS: { id: OutletEditTab; label: string; sublabel: string; icon: typeof Info }[] = [
  { id: "basic", label: "Basic Information", sublabel: "Name, contact & hours", icon: Info },
  { id: "address", label: "Address", sublabel: "Location & coordinates", icon: MapPin },
  { id: "delivery", label: "Delivery", sublabel: "Availability & zones", icon: Truck },
  { id: "pickup", label: "Pickup", sublabel: "In-store template", icon: Package },
  { id: "qr", label: "QR", sublabel: "Storefront QR code", icon: QrCode },
];

export default function OutletEditSidebar({
  active,
  onSelect,
  outletActive,
  onToggleActive,
}: {
  active: OutletEditTab;
  onSelect: (tab: OutletEditTab) => void;
  outletActive: boolean;
  onToggleActive: () => void;
}) {
  return (
    <nav className="sm:w-64 shrink-0 space-y-4">
      <div className="flex items-center justify-between rounded-lg border border-border dark:border-white/10 p-3">
        <span className="text-sm font-medium">Outlet is {outletActive ? "Active" : "Inactive"}</span>
        <Toggle checked={outletActive} onChange={onToggleActive} />
      </div>

      <div className="space-y-1">
        {TABS.map(({ id, label, sublabel, icon: Icon }) => {
          const isActive = active === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onSelect(id)}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors cursor-pointer ${
                isActive
                  ? "bg-accent/10 text-accent-text dark:text-accent"
                  : "text-text-secondary dark:text-zinc-400 hover:bg-black/[0.02] dark:hover:bg-white/[0.03] hover:text-zinc-800 dark:hover:text-zinc-200"
              }`}
            >
              <Icon className="size-4.5 shrink-0" strokeWidth={1.75} />
              <span className="min-w-0">
                <span className="block text-sm font-semibold truncate">{label}</span>
                <span className="block text-xs text-text-faint truncate">{sublabel}</span>
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
