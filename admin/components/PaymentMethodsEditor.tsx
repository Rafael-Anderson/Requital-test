"use client";

import Checkbox from "@/components/ui/Checkbox";

export interface PaymentMethodsValue {
  cardOnline: boolean;
  cashOnFulfillment: boolean; // Cash on Delivery / Cash on Pickup, depending on context
  cardOnFulfillment: boolean; // Card on Delivery / Card on Pickup, depending on context
}

// Shared between the Delivery and Pickup tabs — same shape, different
// labels and (in the parent) a different pair of Shop columns underneath.
export default function PaymentMethodsEditor({
  context,
  value,
  onChange,
}: {
  context: "delivery" | "pickup";
  value: PaymentMethodsValue;
  onChange: (next: PaymentMethodsValue) => void;
}) {
  const cashLabel = context === "delivery" ? "Cash on Delivery (COD)" : "Cash on Pickup";
  const cardLabel = context === "delivery" ? "Card on Delivery" : "Card on Pickup";

  return (
    <div className="space-y-2">
      <Checkbox
        label="Card (Paid Online)"
        checked={value.cardOnline}
        onChange={(e) => onChange({ ...value, cardOnline: e.target.checked })}
      />
      <Checkbox
        label={cashLabel}
        checked={value.cashOnFulfillment}
        onChange={(e) => onChange({ ...value, cashOnFulfillment: e.target.checked })}
      />
      <Checkbox
        label={cardLabel}
        checked={value.cardOnFulfillment}
        onChange={(e) => onChange({ ...value, cardOnFulfillment: e.target.checked })}
      />
    </div>
  );
}
