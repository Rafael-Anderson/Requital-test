"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface TabItem {
  href: string;
  label: string;
  // Default true (active only on an exact pathname match). Set false for a
  // tab whose sub-routes should also count as active (e.g. a list page with
  // its own /new and /:id/edit routes) — matched via pathname.startsWith.
  exact?: boolean;
}

// Shared underline-style tab row (2026-08 admin redesign) — every sub-nav
// across the admin app (Orders, Products, Settings, Affiliate, Theme,
// Reports, Inventory) routes through this one component so the look only
// needs to change in one place. Replaces the old "browser tab" boxed style:
// active tab = teal text + 2px teal bottom border; inactive = muted gray,
// no underline. The container's border-gray-200 (not a bare `border-b`,
// which resolves to `currentColor` — i.e. black — under Tailwind v4, see
// CLAUDE.md's own documented gotcha) is the shared baseline every tab's
// bottom border sits on.
export default function Tabs({ tabs, className = "mb-4" }: { tabs: TabItem[]; className?: string }) {
  const pathname = usePathname();
  return (
    <div className={`flex gap-7 overflow-x-auto border-b border-gray-200 dark:border-white/10 ${className}`}>
      {tabs.map((tab) => {
        const active = tab.exact === false ? pathname.startsWith(tab.href) : pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`whitespace-nowrap border-b-2 pb-3 text-sm font-semibold transition-colors ${
              active
                ? "border-accent text-accent-text dark:text-accent"
                : "border-transparent text-text-faint hover:text-text-secondary dark:text-zinc-500 dark:hover:text-zinc-300"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
