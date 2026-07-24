"use client";

import { Info, MapPin, Truck, Map, Package, QrCode } from "lucide-react";

export type OutletEditTab = "basic" | "address" | "delivery" | "deliveryArea" | "pickup" | "qr";

const TABS: { id: OutletEditTab; label: string; sublabel: string; icon: typeof Info }[] = [
  { id: "basic", label: "Basic Information", sublabel: "Name, contact & hours", icon: Info },
  { id: "address", label: "Address", sublabel: "Location & coordinates", icon: MapPin },
  { id: "delivery", label: "Delivery", sublabel: "Radius & availability", icon: Truck },
  { id: "deliveryArea", label: "Delivery Area", sublabel: "Zones & coverage", icon: Map },
  { id: "pickup", label: "Pickup", sublabel: "In-store collection", icon: Package },
  { id: "qr", label: "QR", sublabel: "Coming soon", icon: QrCode },
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
      <div className="flex items-center justify-between rounded-lg border border-black/10 dark:border-white/10 p-3">
        <span className="text-sm font-medium">Outlet is {outletActive ? "Active" : "Inactive"}</span>
        <button
          type="button"
          role="switch"
          aria-checked={outletActive}
          onClick={onToggleActive}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors duration-150 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-zinc-900 focus-visible:ring-black/30 dark:focus-visible:ring-white/40 ${
            outletActive
              ? "bg-green-500 hover:bg-green-600"
              : "bg-zinc-300 dark:bg-zinc-700 hover:bg-zinc-400 dark:hover:bg-zinc-600"
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow-sm transition-transform duration-150 ${
              outletActive ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>
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
                  ? "bg-black/5 dark:bg-white/10 text-black dark:text-white"
                  : "text-zinc-500 hover:bg-black/[0.02] dark:hover:bg-white/[0.03] hover:text-zinc-800 dark:hover:text-zinc-200"
              }`}
            >
              <Icon className="size-4.5 shrink-0" strokeWidth={1.75} />
              <span className="min-w-0">
                <span className="block text-sm font-medium truncate">{label}</span>
                <span className="block text-xs text-zinc-400 truncate">{sublabel}</span>
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
