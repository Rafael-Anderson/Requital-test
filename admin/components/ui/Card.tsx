import type { HTMLAttributes } from "react";

// Section-container shade — 2026-08 admin redesign: 16px radius, 1px border,
// no shadow at rest (the page background is now a soft gray, #F7F8F8, so a
// plain white card with a 1px border already reads as a distinct panel —
// the old shadow-as-separator crutch from a white-on-white page is no
// longer needed in light mode). Dark mode keeps its existing zinc-900-on-
// near-black shade + soft shadow untouched, since the redesign brief
// doesn't cover dark mode.
export default function Card({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-2xl border border-border bg-surface p-6 dark:border-white/10 dark:bg-zinc-900 dark:shadow-sm dark:shadow-black/5 ${className}`}
      {...props}
    />
  );
}
