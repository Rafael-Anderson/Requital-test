"use client";

// The app's switch control for binary status fields (active/inactive,
// open/closed, enabled/disabled) — green when on, neutral grey when off.
// Off used to be red, but red reads as "broken/error," not "not turned on
// yet" — every real usage (outlet active, delivery/pickup available,
// Track inventory, a payment gateway not yet configured...) is a normal,
// healthy "off" state, not a problem. Reserve red for an actual
// destructive/error affordance if one is ever needed here, not for this
// component. Reserve Checkbox for actual multi-select option lists; this
// is for a single on/off state. See "Admin settings/config page layout
// convention" in CLAUDE.md.
export default function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors duration-150 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-zinc-900 focus-visible:ring-accent/50 disabled:opacity-40 disabled:cursor-not-allowed ${
        checked
          ? "bg-green-500 hover:bg-green-600"
          : "bg-zinc-300 hover:bg-zinc-400 dark:bg-zinc-600 dark:hover:bg-zinc-500"
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow-sm transition-transform duration-150 ${
          checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}
