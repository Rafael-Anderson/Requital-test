"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/inventory", label: "Products" },
  { href: "/inventory/categories", label: "Categories" },
  { href: "/inventory/ingredients", label: "Ingredients" },
  { href: "/inventory/scan", label: "Scan to Stock" },
  { href: "/inventory/movements", label: "Movement History" },
];

export default function InventoryTabs() {
  const pathname = usePathname();

  return (
    <div className="flex items-center gap-1 border-b dark:border-white/10 mb-4">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              active
                ? "border-accent text-accent-text"
                : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
