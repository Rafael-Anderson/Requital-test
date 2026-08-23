import type { PaymentMethod } from "@/lib/types";

// Shared between CheckoutSinglePage and CheckoutSteps — same visible-input
// treatment as admin's components/ui/Input.tsx. Previously used a literal
// `dark:bg-zinc-900` pairing with no matching `dark:text-*`, from back when
// the storefront was assumed to follow OS dark mode — it no longer does
// (see globals.css's own comment on removing that override, since a
// visitor's OS preference has no business overriding a shop's own
// branding), but Tailwind's `dark:` variant still keys off
// prefers-color-scheme independently of that CSS-variable change, so the
// background kept flipping dark while inherited text stayed dark too,
// producing invisible text on an OS-dark-mode visitor. Fixed by dropping
// every `dark:` class in favor of the same static, merchant-controlled
// `--background`/`--color-accent` tokens lib/form-styles.ts's own FIELD_CLASS
// already used correctly.
export const FIELD_CLASS =
  "w-full h-10 rounded-lg border-none bg-[color-mix(in_srgb,var(--color-accent)_6%,var(--background))] px-3 text-sm outline-none transition-shadow focus:ring-[3px] focus:ring-accent/25";
export const COMPACT_FIELD_CLASS =
  "flex-1 h-9 rounded-lg border-none bg-[color-mix(in_srgb,var(--color-accent)_6%,var(--background))] px-3 text-sm outline-none transition-shadow focus:ring-[3px] focus:ring-accent/25";
export const TEXTAREA_CLASS =
  "w-full rounded-lg border-none bg-[color-mix(in_srgb,var(--color-accent)_6%,var(--background))] px-3 py-2 text-sm outline-none transition-shadow focus:ring-[3px] focus:ring-accent/25";
export const BUTTON_OUTLINE_CLASS =
  "border border-stroke bg-background text-foreground";

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  card_online: "Pay online (card)",
  cash_on_delivery: "Cash on delivery",
  card_on_delivery: "Card on delivery",
  cash_on_pickup: "Cash on pickup",
  card_on_pickup: "Card on pickup",
  paypal: "PayPal",
  tabby: "Tabby",
  tamara: "Tamara",
};
