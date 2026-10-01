"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { SETTINGS_GROUPS } from "@/lib/settings-registry";

// The grouped Settings sidebar (audit §14.4). Driven by the same registry as
// the landing page and its search, so the three can never disagree. Pages that
// live in another top-level app (Integrations, Theme) are shown with an arrow:
// Integrations stays its own app, Settings only links into it.
export default function SettingsNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Settings" className="sm:w-[220px] shrink-0 space-y-4">
      {SETTINGS_GROUPS.map((group) => (
        <div key={group.id}>
          <p className="px-3.5 mb-1 text-[11px] font-bold uppercase tracking-wide text-text-faint">{group.label}</p>
          <div className="flex flex-col gap-0.5">
            {group.pages.map(({ href, label, external }) => {
              const active = !external && pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center justify-between px-3.5 py-2 rounded-[10px] text-[13.5px] font-bold transition-colors ${
                    active
                      ? "bg-accent-tint text-accent-text dark:bg-accent/15 dark:text-accent"
                      : "text-text-secondary dark:text-zinc-400 hover:bg-neutral-chip-bg dark:hover:bg-white/10"
                  }`}
                >
                  {label}
                  {external && <ArrowUpRight className="size-3.5 opacity-60" aria-hidden="true" />}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
