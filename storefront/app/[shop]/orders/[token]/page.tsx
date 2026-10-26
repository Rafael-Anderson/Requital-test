"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { CheckCircle2, CircleAlert, Loader2, MapPin, MessageCircle, Package, Phone, XCircle } from "lucide-react";
import { useShop } from "@/lib/shop-context";
import { useCart } from "@/lib/cart";
import { HttpError, lookupOrder, resolveImageUrl } from "@/lib/api";
import { formatPriceAmount } from "@/lib/currency";
import { hasAmount } from "@/lib/order-money-rows";
import { track } from "@/lib/analytics";
import { takeStashedPurchase } from "@/lib/purchase-tracking";
import { buildWhatsAppUrl } from "@/lib/whatsapp-button";
import { parseJsonField } from "@/lib/notification-text";
import {
  POLL_INTERVAL_MS,
  POLL_MAX_TICKS,
  derivePaymentView,
  formatDeliveryDate,
  isTrackingToken,
  paymentMethodLabel,
  timelineSteps,
  type PaymentView,
} from "@/lib/order-confirmation";
import { discardCheckoutAttempt } from "@/lib/checkout-attempt";
import type { OrderLookupResult } from "@/lib/types";
import StorefrontPageShell from "@/components/StorefrontPageShell";
import CurrencySymbol from "@/components/CurrencySymbol";

const CARD = "rounded-2xl border border-foreground/10 bg-background p-4 sm:p-6";
const BUTTON_PRIMARY =
  "inline-flex h-11 items-center justify-center rounded-lg bg-button px-5 font-medium text-button-foreground transition-opacity hover:opacity-90";
const BUTTON_OUTLINE =
  "inline-flex h-11 items-center justify-center rounded-lg border border-foreground/20 bg-background px-5 font-medium text-foreground transition-colors hover:bg-foreground/5";

function Money({ value, currency }: { value: string; currency: string }) {
  return (
    <span className="whitespace-nowrap">
      {formatPriceAmount(value, currency)} <CurrencySymbol code={currency} />
    </span>
  );
}

function Row({ label, children, strong }: { label: string; children: React.ReactNode; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 ${strong ? "border-t border-foreground/10 pt-3 text-base font-semibold" : "text-sm"}`}>
      <span className={strong ? "" : "text-foreground/60"}>{label}</span>
      <span className="text-end">{children}</span>
    </div>
  );
}

function ConfirmationSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading your order">
      <div className="mx-auto h-8 w-2/3 rounded-lg bg-foreground/10 motion-safe:animate-pulse" />
      <div className="mx-auto h-4 w-1/3 rounded bg-foreground/10 motion-safe:animate-pulse" />
      <div className="h-24 rounded-2xl bg-foreground/10 motion-safe:animate-pulse" />
      <div className="h-48 rounded-2xl bg-foreground/10 motion-safe:animate-pulse" />
    </div>
  );
}

// What we know about payment, in words. Every branch is a function of the
// server's order, never of the URL (see derivePaymentView).
function PaymentBanner({ view, onCheckAgain }: { view: PaymentView; onCheckAgain: () => void }) {
  switch (view.kind) {
    case "paid":
      return (
        <p className="flex items-center gap-2 text-accent-text">
          <CheckCircle2 className="size-5 shrink-0" aria-hidden="true" /> Payment received.
        </p>
      );
    case "refunded":
      return (
        <p className="flex items-center gap-2 text-foreground/70">
          <CircleAlert className="size-5 shrink-0" aria-hidden="true" /> This payment was refunded.
        </p>
      );
    case "confirming":
      return (
        <p className="flex items-center gap-2 text-foreground/80">
          <Loader2 className="size-5 shrink-0 motion-safe:animate-spin" aria-hidden="true" /> Confirming your payment...
        </p>
      );
    case "unconfirmed":
      return (
        <div className="space-y-2">
          <p className="flex items-start gap-2 text-foreground/80">
            <CircleAlert className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
            <span>
              We have not received confirmation of your payment yet. This can take a few minutes. Your order is placed, and we will
              update it here once the payment clears.
            </span>
          </p>
          <button type="button" onClick={onCheckAgain} className="text-sm font-medium text-accent-text hover:underline">
            Check again
          </button>
        </div>
      );
    case "failed":
      return (
        <p className="flex items-start gap-2 text-red-600">
          <XCircle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <span>Your payment did not go through. Please contact the shop below to complete this order.</span>
        </p>
      );
    case "cancelled":
      return (
        <p className="flex items-start gap-2 text-red-600">
          <XCircle className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <span>This order was cancelled. If you have questions about your payment, please contact the shop below.</span>
        </p>
      );
    case "on_delivery":
      return <p className="text-foreground/80">You will pay when your order is delivered.</p>;
    case "on_pickup":
      return <p className="text-foreground/80">You will pay when you collect your order.</p>;
    default:
      return <p className="text-foreground/80">Payment has not been taken yet.</p>;
  }
}

function Timeline({ order }: { order: OrderLookupResult }) {
  const steps = timelineSteps(order.status, order.orderType);
  return (
    <ol className="grid grid-cols-5 gap-1" aria-label="Order progress">
      {steps.map((s) => (
        <li key={s.key} className="min-w-0 text-center" aria-current={s.state === "current" ? "step" : undefined}>
          <div className="flex items-center">
            <span className={`h-0.5 flex-1 ${s.key === "pending" ? "bg-transparent" : s.state === "upcoming" ? "bg-foreground/15" : "bg-accent"}`} />
            <span
              className={`mx-1 grid size-5 shrink-0 place-items-center rounded-full border-2 ${
                s.state === "upcoming" ? "border-foreground/20 bg-background" : "border-accent bg-accent"
              }`}
            >
              {s.state === "done" && <CheckCircle2 className="size-3 text-accent-foreground" aria-hidden="true" />}
            </span>
            <span className={`h-0.5 flex-1 ${s.key === "delivered" ? "bg-transparent" : s.state === "done" ? "bg-accent" : "bg-foreground/15"}`} />
          </div>
          <p className={`mt-2 text-[11px] leading-tight sm:text-xs ${s.state === "upcoming" ? "text-foreground/50" : "font-medium"}`}>{s.label}</p>
        </li>
      ))}
    </ol>
  );
}

function OrderBody({ order, token, view, onCheckAgain }: { order: OrderLookupResult; token: string; view: PaymentView; onCheckAgain: () => void }) {
  const { shop, shopBasePath } = useShop();
  const c = order.currency;
  const isPickup = order.orderType === "pickup";
  const dateText = formatDeliveryDate(order.deliveryDate);
  const methodLabel = paymentMethodLabel(order.paymentMethod);
  const wa = buildWhatsAppUrl(shop?.whatsappCountryCode ?? null, shop?.whatsappNumber ?? null, `Hi, I have a question about order #${order.shopOrderNumber}`);
  const phone = parseJsonField<string[]>(shop?.contactNumbers, [])[0];
  const email = shop?.email ?? null;
  const showTimeline = view.kind !== "cancelled";
  const showDeliveryRow = order.orderType === "delivery" && order.deliveryFee !== null;
  const usedCredit = hasAmount(order.giftCardAmount) || hasAmount(order.storeCreditAmount);

  return (
    <div className="space-y-4">
      <header className="text-center">
        <h1 className="text-2xl font-semibold sm:text-3xl">
          {view.kind === "cancelled" ? "This order was cancelled" : view.kind === "failed" ? "Your payment did not go through" : "Thank you for your order"}
        </h1>
        <p className="mt-2 text-foreground/70">
          Order <span className="font-semibold text-foreground">#{order.shopOrderNumber}</span> from {order.shopName}
        </p>
      </header>

      <section className={CARD} role="status" aria-live="polite">
        <PaymentBanner view={view} onCheckAgain={onCheckAgain} />
      </section>

      {showTimeline && (
        <section className={CARD}>
          <Timeline order={order} />
        </section>
      )}

      <section className={CARD}>
        <h2 className="mb-3 text-base font-semibold">Your items</h2>
        <ul className="divide-y divide-foreground/10">
          {order.items.map((item, i) => {
            const img = resolveImageUrl(item.imageUrl);
            return (
              <li key={i} className="flex gap-3 py-3 first:pt-0 last:pb-0">
                {img ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={img} alt="" width={64} height={64} loading="lazy" className="size-16 shrink-0 rounded-lg object-cover" />
                ) : (
                  <span className="grid size-16 shrink-0 place-items-center rounded-lg bg-foreground/5 text-foreground/40">
                    <Package className="size-6" aria-hidden="true" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="font-medium [overflow-wrap:anywhere]">{item.productName}</p>
                  {item.variantLabel && <p className="text-sm text-foreground/60 [overflow-wrap:anywhere]">{item.variantLabel}</p>}
                  {item.note && <p className="text-sm text-foreground/60 [overflow-wrap:anywhere]">Note: {item.note}</p>}
                  <p className="text-sm text-foreground/60">
                    {item.quantity} x <Money value={item.priceAtPurchase} currency={c} />
                  </p>
                </div>
                <p className="shrink-0 text-sm font-medium">
                  <Money value={item.lineTotal} currency={c} />
                </p>
              </li>
            );
          })}
        </ul>
        <div className="mt-4 space-y-2 border-t border-foreground/10 pt-4">
          <Row label="Subtotal">
            <Money value={order.subtotal} currency={c} />
          </Row>
          {hasAmount(order.discountAmount) && (
            <Row label={`Discount${order.discountCode ? ` (${order.discountCode})` : ""}`}>
              -<Money value={order.discountAmount!} currency={c} />
            </Row>
          )}
          {showDeliveryRow && (
            <Row label="Delivery fee">{hasAmount(order.deliveryFee) ? <Money value={order.deliveryFee!} currency={c} /> : "Free"}</Row>
          )}
          {hasAmount(order.taxAmount) && (
            <Row label={order.taxInclusive ? "Includes tax" : "Tax"}>
              <Money value={order.taxAmount!} currency={c} />
            </Row>
          )}
          {hasAmount(order.giftCardAmount) && (
            <Row label="Gift card">
              -<Money value={order.giftCardAmount!} currency={c} />
            </Row>
          )}
          {hasAmount(order.storeCreditAmount) && (
            <Row label="Store credit">
              -<Money value={order.storeCreditAmount!} currency={c} />
            </Row>
          )}
          <Row label="Total" strong>
            <Money value={order.total} currency={c} />
          </Row>
          {usedCredit && hasAmount(order.amountDue) && (
            <Row label="Amount due">
              <Money value={order.amountDue} currency={c} />
            </Row>
          )}
        </div>
      </section>

      <section className={CARD}>
        <h2 className="mb-3 text-base font-semibold">{isPickup ? "Pickup" : "Delivery"}</h2>
        <div className="space-y-3 text-sm">
          {isPickup && order.pickupLocation ? (
            <div className="flex gap-2">
              <MapPin className="mt-0.5 size-4 shrink-0 text-foreground/60" aria-hidden="true" />
              <div className="min-w-0 [overflow-wrap:anywhere]">
                <p className="font-medium">{order.pickupLocation.name}</p>
                {order.pickupLocation.area && <p className="text-foreground/70">{order.pickupLocation.area}</p>}
                {order.pickupLocation.phone && (
                  <a href={`tel:${order.pickupLocation.phone}`} className="text-accent-text hover:underline">
                    {order.pickupLocation.phone}
                  </a>
                )}
                {order.pickupLocation.latitude !== null && order.pickupLocation.longitude !== null && (
                  <p>
                    <a
                      href={`https://www.google.com/maps?q=${order.pickupLocation.latitude},${order.pickupLocation.longitude}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent-text hover:underline"
                    >
                      Open in maps
                    </a>
                  </p>
                )}
              </div>
            </div>
          ) : (
            order.deliveryAddress && (
              <div className="flex gap-2">
                <MapPin className="mt-0.5 size-4 shrink-0 text-foreground/60" aria-hidden="true" />
                <div className="min-w-0 [overflow-wrap:anywhere]">
                  <p>{order.deliveryAddress}</p>
                  {(order.area || order.region) && (
                    <p className="text-foreground/70">{[order.area, order.region?.nameEn].filter(Boolean).join(", ")}</p>
                  )}
                </div>
              </div>
            )
          )}
          {(dateText || order.deliveryTimeSlot) && (
            <Row label={isPickup ? "Pickup time" : "Delivery time"}>
              {[dateText, order.deliveryTimeSlot].filter(Boolean).join(", ")}
            </Row>
          )}
          {methodLabel && <Row label="Payment method">{methodLabel}</Row>}
        </div>
      </section>

      {(wa || phone || email) && (
        <section className={CARD}>
          <h2 className="mb-3 text-base font-semibold">Questions about your order?</h2>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
            {wa && (
              <a href={wa} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-accent-text hover:underline">
                <MessageCircle className="size-4" aria-hidden="true" /> WhatsApp
              </a>
            )}
            {phone && (
              <a href={`tel:${phone}`} className="inline-flex items-center gap-2 text-accent-text hover:underline">
                <Phone className="size-4" aria-hidden="true" /> {phone}
              </a>
            )}
            {email && (
              <a href={`mailto:${email}`} className="text-accent-text hover:underline [overflow-wrap:anywhere]">
                {email}
              </a>
            )}
          </div>
        </section>
      )}

      <section className={CARD}>
        <p className="text-sm font-medium">Your tracking code</p>
        <p className="mt-1 text-xs text-foreground/60">Use it to check this order any time, no account needed.</p>
        <p className="mt-2 break-all font-mono text-sm tracking-wide">{token}</p>
      </section>

      <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:justify-center">
        <Link href={`${shopBasePath}/orders/track?token=${encodeURIComponent(token)}`} className={BUTTON_OUTLINE}>
          Track order
        </Link>
        <Link href={shopBasePath || "/"} className={BUTTON_PRIMARY}>
          Continue shopping
        </Link>
      </div>
    </div>
  );
}

// A link that carries something other than a tracking code (the old
// /orders/<number> shape, e.g. a gateway return created before the token
// URLs) opens nothing: no request is made, no order data is shown, and nothing
// is said about payment either way.
function CannotOpen() {
  const { shopBasePath } = useShop();
  return (
    <div className={`${CARD} text-center`}>
      <h1 className="text-xl font-semibold">This order link is out of date</h1>
      <p className="mt-2 text-sm text-foreground/70">
        Links that use an order number can no longer open an order. Use the link in your order confirmation email or message, or
        look the order up with your tracking code.
      </p>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:justify-center">
        <Link href={`${shopBasePath}/orders/track`} className={BUTTON_PRIMARY}>
          Track an order
        </Link>
        <Link href={shopBasePath || "/"} className={BUTTON_OUTLINE}>
          Continue shopping
        </Link>
      </div>
    </div>
  );
}

function LoadError({ notFound, message, onRetry }: { notFound: boolean; message: string; onRetry: () => void }) {
  const { shopBasePath } = useShop();
  return (
    <div className={`${CARD} text-center`} role="alert">
      <h1 className="text-xl font-semibold">{notFound ? "We could not find that order" : "We could not load your order"}</h1>
      <p className="mt-2 text-sm text-foreground/70">{notFound ? "Check the link or tracking code and try again." : message}</p>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:justify-center">
        <button type="button" onClick={onRetry} className={BUTTON_PRIMARY}>
          Try again
        </button>
        <Link href={`${shopBasePath}/orders/track`} className={BUTTON_OUTLINE}>
          Track an order
        </Link>
      </div>
    </div>
  );
}

export default function OrderConfirmationPage() {
  const params = useParams<{ shop: string; token: string }>();
  const { shopSlug } = useShop();
  const { clear } = useCart();
  const token = params.token;
  const valid = isTrackingToken(token);

  const [order, setOrder] = useState<OrderLookupResult | null>(null);
  const [error, setError] = useState<{ status: number | null; message: string } | null>(null);
  const [loading, setLoading] = useState(valid);
  const [retryKey, setRetryKey] = useState(0);
  // Visible polling ticks spent waiting for a gateway to confirm the payment.
  const [ticks, setTicks] = useState(0);
  const pollExhausted = ticks >= POLL_MAX_TICKS;

  useEffect(() => {
    if (!valid) return;
    let cancelled = false;
    lookupOrder(token, shopSlug)
      .then((o) => {
        if (!cancelled) setOrder(o);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError({
          status: err instanceof HttpError ? err.status : null,
          message: err instanceof Error ? err.message : "Something went wrong",
        });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [valid, token, shopSlug, retryKey]);

  const view = order ? derivePaymentView(order, pollExhausted) : null;
  const polling = view?.kind === "confirming";

  // Bounded wait for the gateway's webhook: every 2s, at most POLL_MAX_TICKS
  // ticks, only while the tab is visible, stopping the moment the order leaves
  // "unpaid online" (paid, failed, cancelled) or the window runs out.
  useEffect(() => {
    if (!polling || !valid) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (cancelled) return;
      if (document.hidden) {
        timer = setTimeout(tick, POLL_INTERVAL_MS);
        return;
      }
      lookupOrder(token, shopSlug)
        .then((o) => {
          if (!cancelled) setOrder(o);
        })
        .catch(() => {
          // A failed poll is not a verdict on the payment; the tick still counts.
        })
        .finally(() => {
          if (cancelled) return;
          setTicks((t) => t + 1);
          timer = setTimeout(tick, POLL_INTERVAL_MS);
        });
    };
    timer = setTimeout(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [polling, valid, token, shopSlug]);

  // The browser half of an ONLINE-payment purchase (lib/purchase-tracking.ts):
  // checkout parked the event before sending the customer to the gateway. It is
  // sent only once the SERVER says the order is paid, never on a query string,
  // and taken (not read) so a reload cannot send it twice. Having a stash also
  // means this browser started that checkout moments ago, which is the only
  // case in which clearing the cart (online checkout does not clear it) cannot
  // wipe a newer cart.
  const orderId = order?.id;
  const paid = order?.paymentStatus === "paid";
  useEffect(() => {
    if (!paid || orderId === undefined) return;
    // The checkout attempt that produced this order is finished: a later purchase
    // of the same cart must be a new order (lib/checkout-attempt.ts).
    discardCheckoutAttempt(shopSlug);
    const stashed = takeStashedPurchase(orderId);
    if (stashed) {
      track("purchase", stashed);
      clear();
    }
  }, [paid, orderId, clear, shopSlug]);

  const retry = useCallback(() => {
    setError(null);
    setOrder(null);
    setLoading(true);
    setTicks(0);
    setRetryKey((k) => k + 1);
  }, []);

  const checkAgain = useCallback(() => {
    setTicks(0);
    setRetryKey((k) => k + 1);
  }, []);

  return (
    <StorefrontPageShell variant="medium">
      <div className="py-6 sm:py-10">
        {!valid ? (
          <CannotOpen />
        ) : loading ? (
          <ConfirmationSkeleton />
        ) : order && view ? (
          <OrderBody order={order} token={token} view={view} onCheckAgain={checkAgain} />
        ) : (
          <LoadError notFound={error?.status === 404} message={error?.message ?? "Something went wrong"} onRetry={retry} />
        )}
      </div>
    </StorefrontPageShell>
  );
}
