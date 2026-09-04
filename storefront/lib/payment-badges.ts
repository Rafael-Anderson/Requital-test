import { Banknote, CreditCard } from "lucide-react";
import type { Shop } from "@/lib/types";

export interface PaymentBadge {
  key: string;
  label: string;
  Icon: typeof CreditCard;
}

// Extracted from components/Footer.tsx (pre-C1 legacy footer) so
// ThemeDrivenFooter.tsx's showPaymentIcons setting can render the same real
// badge list — real config, not a fixed icon set that might not match what
// this shop actually accepts. Footer.tsx keeps its own render unchanged,
// just imports this instead of defining it locally.
export function paymentBadges(shop: Shop): PaymentBadge[] {
  const badges: PaymentBadge[] = [];
  if (shop.cardProcessorEnabled) badges.push({ key: "card", label: "Card", Icon: CreditCard });
  if (shop.deliveryPaymentCashOnDelivery || shop.pickupPaymentCashOnPickup) {
    badges.push({ key: "cash", label: "Cash", Icon: Banknote });
  }
  for (const provider of shop.enabledPaymentProviders) {
    badges.push({ key: provider, label: provider.charAt(0).toUpperCase() + provider.slice(1), Icon: CreditCard });
  }
  return badges;
}
