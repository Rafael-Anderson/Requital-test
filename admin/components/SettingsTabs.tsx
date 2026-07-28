"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/settings/business", label: "Business Settings" },
  { href: "/settings/outlets", label: "Outlets" },
  { href: "/settings/users", label: "Users" },
];

export default function SettingsTabs() {
  const pathname = usePathname();

  return (
    <div className="flex gap-1 border-b dark:border-white/10 mb-6">
      {TABS.map((tab) => {
        const active = pathname.startsWith(tab.href);
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
