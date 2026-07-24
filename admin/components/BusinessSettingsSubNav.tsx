"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// No QR Code Setup entry at all (explicitly out of scope).
const ITEMS = [
  { href: "/settings/business/information", label: "Business Information" },
  { href: "/settings/business/store-configuration", label: "Store Configuration" },
  { href: "/settings/business/online-presence", label: "Online Presence" },
];

export default function BusinessSettingsSubNav() {
  const pathname = usePathname();

  return (
    <nav className="sm:w-48 shrink-0 flex sm:flex-col gap-1">
      {ITEMS.map(({ href, label }) => {
        const active = pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              active
                ? "bg-black/5 dark:bg-white/10 text-black dark:text-white"
                : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
