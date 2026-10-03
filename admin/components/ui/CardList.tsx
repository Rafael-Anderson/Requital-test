"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import Checkbox from "@/components/ui/Checkbox";

// The phone layout of a list page (below md): one tappable card per row in
// place of a table whose columns cannot fit. The page keeps its Table for md
// and up, hiding it below (`hidden md:block`); the two never show together.
// Tapping the card opens it (a stretched link, so the whole card is the target);
// the selection checkbox and the `actions` slot sit above that link and do not
// open it.

export function CardList({
  children,
  selectAll,
  className = "",
}: {
  children: ReactNode;
  // Renders a "Select all" row above the cards (the table header's checkbox has
  // no phone equivalent otherwise).
  selectAll?: { checked: boolean; onChange: () => void; label: string };
  className?: string;
}) {
  return (
    <div className={`md:hidden ${className}`}>
      {selectAll && (
        <div className="mb-2 px-1">
          <Checkbox checked={selectAll.checked} onChange={selectAll.onChange} label={selectAll.label} />
        </div>
      )}
      <ul className="space-y-2">{children}</ul>
    </div>
  );
}

export function CardListItem({
  href,
  onOpen,
  openLabel,
  select,
  actions,
  children,
}: {
  href?: string;
  onOpen?: () => void;
  // Accessible name of the stretched open target, e.g. `Edit Rose bouquet`.
  openLabel: string;
  select?: { checked: boolean; onChange: () => void; label: string };
  actions?: ReactNode;
  children: ReactNode;
}) {
  const overlay = "absolute inset-0 z-0 rounded-xl focus-visible:outline-2 focus-visible:outline-accent";
  return (
    <li className="relative flex items-start gap-3 rounded-xl border border-border bg-surface p-3 dark:border-white/10 dark:bg-zinc-900">
      {select && (
        <label className="relative z-10 -m-2.5 flex shrink-0 cursor-pointer items-center p-2.5">
          <Checkbox checked={select.checked} onChange={select.onChange} aria-label={select.label} />
        </label>
      )}
      <div className="min-w-0 flex-1">{children}</div>
      {actions && <div className="relative z-10 shrink-0">{actions}</div>}
      {href ? (
        <Link href={href} aria-label={openLabel} className={overlay} />
      ) : onOpen ? (
        <button type="button" onClick={onOpen} aria-label={openLabel} className={overlay} />
      ) : null}
    </li>
  );
}

// Skeleton rows that mirror CardListItem's box (leading media, two text lines,
// a trailing chip), so the loading state has the final layout's height.
export function CardListSkeleton({
  rows = 5,
  selectable = true,
  className = "",
}: {
  rows?: number;
  selectable?: boolean;
  className?: string;
}) {
  return (
    <ul aria-busy="true" className={`md:hidden space-y-2 ${className}`}>
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="flex items-start gap-3 rounded-xl border border-border bg-surface p-3 dark:border-white/10 dark:bg-zinc-900">
          {selectable && <div className="size-4 shrink-0 animate-pulse rounded bg-black/10 dark:bg-white/10" />}
          <div className="size-12 shrink-0 animate-pulse rounded-md bg-black/10 dark:bg-white/10" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-4 w-2/3 animate-pulse rounded bg-black/10 dark:bg-white/10" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-black/10 dark:bg-white/10" />
          </div>
        </li>
      ))}
    </ul>
  );
}
