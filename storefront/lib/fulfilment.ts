import { resolvePaymentMethods } from "./payment-methods";
import type { Outlet, OrderType } from "./types";

export type FulfilmentMode = "both" | "delivery" | "pickup" | "none";
export type FulfilmentReason = "no_outlet" | "outlet_offers_neither" | "no_payment_methods";

export interface FulfilmentOptions {
  delivery: boolean;
  pickup: boolean;
  mode: FulfilmentMode;
  // Set only when mode is "none".
  reason?: FulfilmentReason;
}

// The ONE answer to "what can this shopper choose at this outlet". There is no
// shop-level delivery/pickup toggle: the toggles are per outlet
// (outlet.deliveryEnabled / pickupEnabled). A type is only offered when the shop
// also has at least one payment method for it (the server 400s otherwise), so
// the selector, the address/pickup fields, the payment list and the submit gate
// all read this and cannot disagree. Hours and the outlet's open/closed state are
// deliberately NOT part of it: they are temporary and have their own messages.
export function resolveFulfilmentOptions(
  shop: Parameters<typeof resolvePaymentMethods>[0],
  outlet: Pick<Outlet, "deliveryEnabled" | "pickupEnabled"> | null,
): FulfilmentOptions {
  const delivery = !!outlet?.deliveryEnabled && resolvePaymentMethods(shop, "delivery").length > 0;
  const pickup = !!outlet?.pickupEnabled && resolvePaymentMethods(shop, "pickup").length > 0;
  if (delivery && pickup) return { delivery, pickup, mode: "both" };
  if (delivery) return { delivery, pickup, mode: "delivery" };
  if (pickup) return { delivery, pickup, mode: "pickup" };
  const reason: FulfilmentReason = !outlet
    ? "no_outlet"
    : !outlet.deliveryEnabled && !outlet.pickupEnabled
      ? "outlet_offers_neither"
      : "no_payment_methods";
  return { delivery, pickup, mode: "none", reason };
}

// The order type actually in force: the shopper's preference when this outlet
// offers it, otherwise whatever it does offer. Derived on every render so
// switching outlet can never leave an order type the outlet does not take.
export function effectiveOrderType(options: FulfilmentOptions, preferred: OrderType): OrderType | null {
  if (options[preferred]) return preferred;
  if (options.delivery) return "delivery";
  if (options.pickup) return "pickup";
  return null;
}

export function fulfilmentUnavailableMessage(reason: FulfilmentReason | undefined): string {
  switch (reason) {
    case "no_payment_methods":
      return "No payment method is available right now, so orders cannot be placed.";
    case "no_outlet":
      return "This shop is not taking orders right now.";
    default:
      return "Neither delivery nor pickup is available right now, so orders cannot be placed.";
  }
}
