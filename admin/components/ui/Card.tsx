import type { HTMLAttributes } from "react";

// Section-container shade — same border/background pairing as StatCard and
// the outlet Table wrapper, so panels read consistently across the app: a
// visible border in light mode (bg-white sits flush against the white page)
// and a genuinely distinct zinc-900-on-near-black shade in dark mode.
// shadow-sm shadow-black/5 is the same soft-elevation treatment already used
// on every form field in the app (Input, Textarea, the various FIELD_CLASS
// inputs) — border alone was too close in value against the white page
// background to read as a distinct panel; the shadow is what actually
// separates it, same as it does for those fields. Barely visible in dark
// mode (shadow-black/5 against a near-black page), which is fine — dark
// mode's zinc-900-on-black contrast already reads fine without it.
export default function Card({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-zinc-900 shadow-sm shadow-black/5 p-6 ${className}`}
      {...props}
    />
  );
}
