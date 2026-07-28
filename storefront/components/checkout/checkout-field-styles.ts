import type { PaymentMethod } from "@/lib/types";

// Shared between CheckoutSinglePage and CheckoutSteps — same visible-input
// treatment as admin's components/ui/Input.tsx (see checkout page's
// original comment for why: storefront follows OS dark mode, not a manual
// toggle, so bare borderless fields go nearly invisible in dark mode).
export const FIELD_CLASS =
  "w-full h-10 rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-zinc-900 px-3 text-sm shadow-sm shadow-black/5 outline-none transition-shadow focus:border-accent focus:ring-[3px] focus:ring-accent/20";
export const COMPACT_FIELD_CLASS =
  "flex-1 h-9 rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-zinc-900 px-3 text-sm shadow-sm shadow-black/5 outline-none transition-shadow focus:border-accent focus:ring-[3px] focus:ring-accent/20";
export const TEXTAREA_CLASS =
  "w-full rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm shadow-black/5 outline-none transition-shadow focus:border-accent focus:ring-[3px] focus:ring-accent/20";
export const BUTTON_OUTLINE_CLASS =
  "border border-black/15 dark:border-white/15 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-200";

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
