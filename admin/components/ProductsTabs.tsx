"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/products", label: "Products" },
  { href: "/products/categories", label: "Collections" },
  { href: "/products/templates", label: "Templates" },
  { href: "/products/discounts", label: "Discounts" },
  { href: "/products/gift-cards", label: "Gift Cards" },
];

export default function ProductsTabs() {
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
