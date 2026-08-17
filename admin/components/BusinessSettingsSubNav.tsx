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
    <nav className="sm:w-[220px] shrink-0 flex sm:flex-col gap-0.5">
      {ITEMS.map(({ href, label }) => {
        const active = pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={`px-3.5 py-2.5 rounded-[10px] text-[13.5px] font-bold transition-colors ${
              active
                ? "bg-accent-tint text-accent-text dark:bg-accent/15 dark:text-accent"
                : "text-text-secondary dark:text-zinc-400 hover:bg-neutral-chip-bg dark:hover:bg-white/10"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
