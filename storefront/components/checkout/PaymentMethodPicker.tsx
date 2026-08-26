"use client";

import { Banknote, CreditCard, Wallet, type LucideIcon } from "lucide-react";
import type { PaymentMethod } from "@/lib/types";
import { PAYMENT_LABELS } from "./checkout-field-styles";

const PAYMENT_ICONS: Record<PaymentMethod, LucideIcon> = {
  card_online: CreditCard,
  card_on_delivery: CreditCard,
  card_on_pickup: CreditCard,
  cash_on_delivery: Banknote,
  cash_on_pickup: Banknote,
  paypal: Wallet,
  tabby: Wallet,
  tamara: Wallet,
};

// Replaces a plain native-radio list — selectable cards, same visual
// language as the fulfillment toggle above it in checkout and the PDP's
// variant chips (border-accent bg-accent/10 selected, border-stroke
// unselected). No hidden native <input type="radio"> — a plain <button> is
// enough here since there's no form-level radiogroup semantics this app
// relies on elsewhere (the fulfillment toggle already sets that precedent).
export default function PaymentMethodPicker({
  methods,
  value,
  onChange,
}: {
  methods: PaymentMethod[];
  value: PaymentMethod | "";
  onChange: (method: PaymentMethod) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {methods.map((m) => {
        const Icon = PAYMENT_ICONS[m];
        const selected = value === m;
        return (
          <button
            key={m}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(m)}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium text-left cursor-pointer transition-colors ${
              selected
                ? "border-accent bg-accent/10 text-accent"
                : "border-stroke text-foreground hover:border-black/30"
            }`}
          >
            <Icon className="size-4 shrink-0" />
            <span>{PAYMENT_LABELS[m]}</span>
          </button>
        );
      })}
    </div>
  );
}
