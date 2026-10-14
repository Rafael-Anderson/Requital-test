import type { OrderLookupResult } from "./types";

// Pure logic for the order confirmation page, so the parts that decide what a
// customer is told about their money are directly testable.

// The two shapes the backend ever issues (lib mirror of TRACKING_TOKEN_SHAPE in
// backend/src/common/token-hash.ts): 32 hex, or the legacy 10 hex. A URL
// segment that is anything else (notably a sequential numeric order id from an
// old link) is never sent to the API and never shows an order.
const TRACKING_TOKEN_SHAPE = /^(?:[0-9a-f]{32}|[0-9a-f]{10})$/i;
export function isTrackingToken(value: string | null | undefined): value is string {
  return typeof value === "string" && TRACKING_TOKEN_SHAPE.test(value);
}

// How long the page keeps asking while a gateway has not yet told the server
// the payment cleared: every 2s, at most 20 visible ticks (about 40s).
export const POLL_INTERVAL_MS = 2000;
export const POLL_MAX_TICKS = 20;

export type PaymentView =
  | { kind: "cancelled" }
  | { kind: "paid" }
  | { kind: "refunded" }
  | { kind: "failed" }
  // Unpaid online order, still within the polling window.
  | { kind: "confirming" }
  // Unpaid online order after the window: not a failure, just not confirmed yet.
  | { kind: "unconfirmed" }
  // Nothing to pay online: the customer pays on delivery or at pickup.
  | { kind: "on_delivery" | "on_pickup" | "pay_later" };

// What to tell the customer about payment. Driven ONLY by the order the server
// returned: a `?paid=1` (or any other query string) is not an input here, so a
// forged or stale return URL can never produce "Payment received".
export function derivePaymentView(
  order: Pick<OrderLookupResult, "status" | "paymentStatus" | "onlinePayment" | "paymentFailed" | "orderType" | "paymentMethod">,
  pollExhausted: boolean,
): PaymentView {
  if (order.status === "cancelled") return { kind: "cancelled" };
  if (order.paymentStatus === "paid") return { kind: "paid" };
  if (order.paymentStatus === "refunded") return { kind: "refunded" };
  if (order.paymentFailed) return { kind: "failed" };
  if (order.onlinePayment) return { kind: pollExhausted ? "unconfirmed" : "confirming" };
  const m = order.paymentMethod ?? "";
  if (m.endsWith("_on_pickup") || (m === "" && order.orderType === "pickup")) return { kind: "on_pickup" };
  if (m.endsWith("_on_delivery") || (m === "" && order.orderType === "delivery")) return { kind: "on_delivery" };
  return { kind: "pay_later" };
}

const METHOD_LABELS: Record<string, string> = {
  card_online: "Card (online)",
  cash_on_delivery: "Cash on delivery",
  card_on_delivery: "Card on delivery",
  cash_on_pickup: "Cash on pickup",
  card_on_pickup: "Card on pickup",
  paypal: "PayPal",
  tabby: "Tabby",
  tamara: "Tamara",
};
export function paymentMethodLabel(method: string | null): string | null {
  if (!method) return null;
  return METHOD_LABELS[method] ?? method.replace(/_/g, " ");
}

export interface TimelineStep {
  key: string;
  label: string;
  state: "done" | "current" | "upcoming";
}

// The order's own status as a left-to-right (start-to-end) timeline. The real
// states are pending, confirmed, preparing, out_for_delivery, delivered; a
// pickup order's out_for_delivery means "ready for pickup" (as the customer
// notification says). Cancelled has no timeline: the page shows a banner.
export function timelineSteps(status: string, orderType: string | null): TimelineStep[] {
  const pickup = orderType === "pickup";
  const steps: { key: string; label: string }[] = [
    { key: "pending", label: "Order placed" },
    { key: "confirmed", label: "Confirmed" },
    { key: "preparing", label: "Preparing" },
    { key: "out_for_delivery", label: pickup ? "Ready for pickup" : "Out for delivery" },
    { key: "delivered", label: pickup ? "Collected" : "Delivered" },
  ];
  const at = Math.max(
    0,
    steps.findIndex((s) => s.key === status),
  );
  return steps.map((s, i) => ({
    ...s,
    state: i < at || status === "delivered" ? "done" : i === at ? "current" : "upcoming",
  }));
}

// "2026-10-14" -> a readable date in the viewer's locale, without ever passing
// through a timezone (a date-only string parsed with new Date() would shift).
export function formatDeliveryDate(ymd: string | null | undefined, locale?: string): string | null {
  if (!ymd) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(d);
}
