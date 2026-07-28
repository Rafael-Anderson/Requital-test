"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// No QR Code Setup entry at all (explicitly out of scope).
const ITEMS = [
  { href: "/settings/business/information", label: "Business Information" },
  { href: "/settings/business/store-configuration", label: "Store Configuration" },
  { href: "/settings/business/online-presence", label: "Online Presence" },
  { href: "/settings/business/seo", label: "SEO" },
  { href: "/settings/business/payments", label: "Payment Gateways" },
  { href: "/settings/business/policy-pages", label: "Policy Pages" },
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
            className={`px-3 py-2 rounded-lg text-sm font-semibold transition-colors ${
              active
                ? "bg-accent/10 text-accent-text dark:text-accent"
                : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
