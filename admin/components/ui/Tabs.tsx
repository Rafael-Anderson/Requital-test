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

// Shared "browser tab" style tab row — every sub-nav across the admin app
// (Orders, Products, Settings, Affiliate, Theme, Reports, Inventory) used to
// hand-roll the same flat underline-tabs markup per component; consolidated
// here so the look only needs to change in one place. The container's
// border-gray-200 (not a bare `border-b`, which resolves to `currentColor` —
// i.e. black — under Tailwind v4, see CLAUDE.md's own documented gotcha) is
// what fixed the previously-black tab underline. The active tab's matching
// background plus a same-color bottom border cancels the container's line
// under just that tab, visually fusing it with the content panel below —
// the actual "looks like a real browser tab" part.
export default function Tabs({ tabs, className = "mb-4" }: { tabs: TabItem[]; className?: string }) {
  const pathname = usePathname();
  return (
    <div className={`flex gap-1.5 overflow-x-auto border-b border-gray-200 dark:border-white/10 ${className}`}>
      {tabs.map((tab) => {
        const active = tab.exact === false ? pathname.startsWith(tab.href) : pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`px-4 py-2 text-sm font-medium whitespace-nowrap rounded-t-lg border transition-colors -mb-px ${
              active
                ? "bg-white dark:bg-zinc-900 border-gray-200 dark:border-white/10 border-b-white dark:border-b-zinc-900 text-accent-text dark:text-accent relative z-10"
                : "bg-zinc-100 dark:bg-zinc-800/60 border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
