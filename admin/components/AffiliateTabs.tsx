"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/affiliate", label: "Affiliate" },
  { href: "/affiliate/codes", label: "Affiliate Codes" },
  { href: "/affiliate/orders", label: "Affiliate Orders" },
];

export default function AffiliateTabs() {
  const pathname = usePathname();

  return (
    <div className="flex gap-1 border-b dark:border-white/10 mb-6 overflow-x-auto">
      {TABS.map((tab) => {
        const active = tab.href === "/affiliate" ? pathname === "/affiliate" : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
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
