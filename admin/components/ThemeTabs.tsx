"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Three tabs, not four — the reference's "Meta" tab (meta title/
// description/keywords/OG image) is entirely redundant with the SEO feature
// already shipped at Settings > Business > SEO, so it isn't rebuilt here.
const TABS = [
  { href: "/theme/edit/site-settings", label: "Site Settings" },
  { href: "/theme/edit/appearance-color", label: "Appearance Color" },
  { href: "/theme/edit/advanced", label: "Advanced" },
];

export default function ThemeTabs() {
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
