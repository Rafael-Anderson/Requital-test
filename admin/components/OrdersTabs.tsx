"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import type { UserRole } from "@/lib/types";

const ALL_TABS: { href: string; label: string; roles: UserRole[] | null }[] = [
  { href: "/orders", label: "Live Orders", roles: null },
  { href: "/orders/history", label: "Order History", roles: null },
  // Mirrors the backend's own @Roles() on these controllers — draft-orders.controller.ts
  // (admin, order_manager) and abandoned-carts.controller.ts (admin only) — so a tab
  // never appears for a role that would just 403 clicking it.
  { href: "/orders/draft-orders", label: "Draft Orders", roles: ["admin", "order_manager"] },
  { href: "/orders/abandoned-carts", label: "Abandoned Carts", roles: ["admin"] },
];

export default function OrdersTabs() {
  const pathname = usePathname();
  const { user } = useAuth();
  const tabs = ALL_TABS.filter((tab) => !tab.roles || (user && tab.roles.includes(user.role)));

  return (
    <div className="flex gap-1 border-b dark:border-white/10 mb-4">
      {tabs.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              active
                ? "border-accent text-accent-text dark:text-accent"
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
