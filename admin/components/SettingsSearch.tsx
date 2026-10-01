"use client";

import { useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import Card from "@/components/ui/Card";
import { SETTINGS_GROUPS, searchSettings } from "@/lib/settings-registry";

// The Settings landing page: a search box over every individual setting, and
// below it the groups as cards (what the sidebar shows, with descriptions).
export default function SettingsSearch() {
  const [query, setQuery] = useState("");
  const hits = searchSettings(query);
  const searching = query.trim().length > 0;

  return (
    <div className="space-y-6">
      <div className="relative max-w-xl">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-text-faint" aria-hidden="true" />
        <input
          type="search"
          aria-label="Search settings"
          placeholder="Search settings, e.g. VAT, delivery hours, logo"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex h-10 w-full rounded-[10px] border border-border dark:border-white/15 bg-surface dark:bg-zinc-900 pl-9 pr-3 text-sm shadow-sm shadow-black/5 outline-none transition-shadow focus:border-accent focus:ring-[3px] focus:ring-accent/20"
        />
      </div>

      {searching ? (
        <Card>
          {hits.length === 0 ? (
            <p className="text-sm text-text-muted">No settings match &ldquo;{query.trim()}&rdquo;.</p>
          ) : (
            <ul className="divide-y divide-border dark:divide-white/10" aria-label="Search results">
              {hits.map((hit) => (
                <li key={`${hit.href}|${hit.label}`}>
                  <Link href={hit.href} className="flex items-baseline justify-between gap-4 py-2.5 hover:text-accent-text dark:hover:text-accent">
                    <span className="text-sm font-semibold">{hit.label}</span>
                    <span className="text-xs text-text-faint shrink-0">{hit.location}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
          {SETTINGS_GROUPS.map((group) => (
            <Card key={group.id}>
              <h2 className="text-[15px] font-bold text-text-primary dark:text-zinc-50">{group.label}</h2>
              <p className="text-xs text-text-faint mb-3">{group.question}</p>
              <ul className="space-y-2">
                {group.pages.map((page) => (
                  <li key={page.href}>
                    <Link href={page.href} className="block group">
                      <span className="text-sm font-semibold text-accent-text dark:text-accent group-hover:underline">
                        {page.label}
                        {page.external ? " ↗" : ""}
                      </span>
                      <span className="block text-xs text-text-muted">{page.description}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
