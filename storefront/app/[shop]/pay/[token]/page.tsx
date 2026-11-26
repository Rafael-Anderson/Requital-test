"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { HttpError, getCustomOrderPay, startCustomOrderPay } from "@/lib/api";
import { useShop } from "@/lib/shop-context";
import { formatPriceAmount } from "@/lib/currency";
import type { CustomOrderPay } from "@/lib/types";
import StorefrontPageShell from "@/components/StorefrontPageShell";
import CurrencySymbol from "@/components/CurrencySymbol";
import { AUTH_CARD_CLASS, AUTH_HEADING_CLASS, BUTTON_PRIMARY_CLASS } from "@/lib/form-styles";

// The pay page of an order the shop prepared for the customer (an admin custom
// order): /pay/<token>. Shows the items, the bill split and the delivery or
// pickup details the shop froze when it sent the link (never its internal
// notes), and a Pay button. Pay creates a fresh gateway session each time, so
// the link never goes stale; the order is confirmed by the gateway, never by
// the page the customer comes back to. No ad or pixel event fires here: the
// path carries a token (lib/redact-token-url.ts, lib/analytics.ts).
function Money({ amount, currency }: { amount: string; currency: string }) {
  return (
    <>
      {formatPriceAmount(amount, currency)} <CurrencySymbol code={currency} />
    </>
  );
}

export default function CustomOrderPayPage() {
  const params = useParams<{ shop: string; token: string }>();
  const { shopBasePath } = useShop();
  const shopSlug = params.shop;
  const token = params.token;

  const [data, setData] = useState<CustomOrderPay | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let live = true;
    getCustomOrderPay(shopSlug, token).then(
      (d) => {
        if (!live) return;
        setData(d);
        setError(null);
      },
      (err: unknown) => {
        if (!live) return;
        if (err instanceof HttpError && err.status === 404) setNotFound(true);
        else setError(err instanceof Error ? err.message : "Couldn't load this order");
      },
    );
    return () => {
      live = false;
    };
  }, [shopSlug, token, reload]);

  async function pay() {
    setStarting(true);
    setError(null);
    try {
      const result = await startCustomOrderPay(shopSlug, token);
      if (result.checkoutUrl) {
        window.location.href = result.checkoutUrl;
        return;
      }
      setReload((k) => k + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start the payment");
    }
    setStarting(false);
  }

  if (notFound) {
    return (
      <StorefrontPageShell variant="narrow">
        <div className={AUTH_CARD_CLASS} data-testid="pay-state-notfound">
          <h1 className={`${AUTH_HEADING_CLASS} mb-2`}>Payment link not found</h1>
          <p className="text-sm text-zinc-500">This link is not valid. Please check it, or contact the shop.</p>
        </div>
      </StorefrontPageShell>
    );
  }

  if (!data) {
    return (
      <StorefrontPageShell variant="narrow">
        <div className={AUTH_CARD_CLASS}>
          {error ? (
            <div role="alert" className="space-y-3">
              <p className="text-sm text-red-600">{error}</p>
              <button type="button" onClick={() => setReload((k) => k + 1)} className="text-sm font-medium text-accent-text hover:underline cursor-pointer">
                Try again
              </button>
            </div>
          ) : (
            <p className="text-sm text-zinc-500">Loading…</p>
          )}
        </div>
      </StorefrontPageShell>
    );
  }

  const { bill, fulfilment: f, shop } = data;
  const c = bill.currency;
  const contact = [shop.phone, shop.email].filter(Boolean).join(" · ");

  return (
    <StorefrontPageShell variant="narrow">
      <div className={`${AUTH_CARD_CLASS} space-y-5`} data-testid={`pay-state-${data.state}`}>
        <div>
          <h1 className={AUTH_HEADING_CLASS}>Your order from {shop.name}</h1>
          <p className="mt-1 text-sm text-zinc-500">Prepared for {f.customerName}</p>
        </div>

        <ul className="space-y-1.5 text-sm">
          {bill.lines.map((l, i) => (
            <li key={i} className="flex justify-between gap-3">
              <span>
                {l.quantity} × {l.name}
                {l.variantLabel ? ` · ${l.variantLabel}` : ""}
              </span>
              <span className="shrink-0">
                <Money amount={l.lineTotal} currency={c} />
              </span>
            </li>
          ))}
        </ul>

        <dl className="space-y-1 border-t border-zinc-200 pt-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-zinc-500">Subtotal</dt>
            <dd>
              <Money amount={bill.subtotal} currency={c} />
            </dd>
          </div>
          {Number(bill.discount.amount) > 0 && (
            <div className="flex justify-between">
              <dt className="text-zinc-500">Discount{bill.discount.code ? ` (${bill.discount.code})` : ""}</dt>
              <dd>
                -<Money amount={bill.discount.amount} currency={c} />
              </dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt className="text-zinc-500">{f.orderType === "pickup" ? "Pickup" : "Delivery"}</dt>
            <dd>{Number(bill.deliveryFee ?? 0) > 0 ? <Money amount={bill.deliveryFee!} currency={c} /> : "Free"}</dd>
          </div>
          {bill.taxAmount !== null && Number(bill.taxAmount) > 0 && (
            <div className="flex justify-between">
              <dt className="text-zinc-500">{bill.taxInclusive ? "Includes tax" : "Tax"}</dt>
              <dd>
                <Money amount={bill.taxAmount} currency={c} />
              </dd>
            </div>
          )}
          {bill.total !== null && (
            <div className="flex justify-between pt-1 text-base font-semibold">
              <dt>Total</dt>
              <dd>
                <Money amount={bill.total} currency={c} />
              </dd>
            </div>
          )}
        </dl>

        <div className="space-y-1 text-sm text-zinc-600">
          {f.orderType === "pickup" ? (
            <p>Pickup at {f.outletName}</p>
          ) : (
            <p>Delivery to {[f.customerAddress, f.area, f.regionName].filter(Boolean).join(", ")}</p>
          )}
          {f.deliveryDate && (
            <p>
              {f.orderType === "pickup" ? "Pickup" : "Delivery"} on {f.deliveryDate}
              {f.deliveryTimeSlot ? `, ${f.deliveryTimeSlot}` : ""}
            </p>
          )}
          {f.receiverName && (
            <p>
              Receiver: {f.receiverName}
              {f.receiverPhone ? `, ${f.receiverPhone}` : ""}
            </p>
          )}
          {f.receiverMessage && <p>Gift message: {f.receiverMessage}</p>}
          {f.customerNote && <p>Note: {f.customerNote}</p>}
        </div>

        {data.state === "payable" && (
          <div className="space-y-2">
            <button type="button" onClick={() => void pay()} disabled={starting} className={BUTTON_PRIMARY_CLASS}>
              {starting ? "Redirecting…" : "Pay"}
            </button>
            {error && (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            )}
          </div>
        )}
        {data.state === "paid" && (
          <div className="space-y-2" role="status">
            <p className="text-sm font-medium text-green-700">
              Paid. Thank you{data.order ? `: your order is #${data.order.shopOrderNumber}` : ""}.
            </p>
            {data.order && (
              <Link href={`${shopBasePath}/orders/${data.order.trackingToken}`} className="text-sm font-medium text-accent-text hover:underline">
                Track your order
              </Link>
            )}
          </div>
        )}
        {data.state === "unavailable" && (
          <p role="status" className="text-sm text-amber-700">
            Card payment is temporarily unavailable. Please contact the shop{contact ? `: ${contact}` : ""}.
          </p>
        )}
        {data.state === "expired" && (
          <p role="status" className="text-sm text-red-600">
            This payment link has expired. Ask the shop to send you a new one.
          </p>
        )}
        {data.state === "cancelled" && (
          <p role="status" className="text-sm text-red-600">
            This order was cancelled by the shop. Nothing is owed.
          </p>
        )}
        {data.state === "closed" && (
          <p role="status" className="text-sm text-zinc-600">
            No online payment is needed for this order. The shop will arrange payment with you.
          </p>
        )}

        {contact && data.state !== "unavailable" && (
          <p className="text-xs text-zinc-500">
            Questions? Contact {shop.name}: {contact}
          </p>
        )}
      </div>
    </StorefrontPageShell>
  );
}
