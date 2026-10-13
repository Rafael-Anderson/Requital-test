"use client";

import type { CheckoutFormState } from "@/lib/useCheckoutForm";
import CurrencySymbol from "@/components/CurrencySymbol";
import { formatPriceAmount } from "@/lib/currency";

function Amount({ value, currency }: { value: number | string; currency?: string }) {
  return (
    <>
      {formatPriceAmount(value, currency)} <CurrencySymbol code={currency} />
    </>
  );
}

// The order summary of both checkout layouts. Once the server has quoted the
// cart, EVERY figure here is the server's (subtotal, discount, tax, delivery,
// total from POST delivery-quote, which runs the same pricing the order is
// charged with); nothing is added up in the browser. Before a quote exists the
// delivery row says so and the total is withheld rather than shown without
// delivery. The tax row alone falls back to the display mirror (lib/order-tax.ts).
export default function CheckoutSummary({ state }: { state: CheckoutFormState }) {
  const { shop, subtotal, taxQuote, discountAmount, giftCardAmount, orderType, deliveryQuote, retryDeliveryQuote } = state;
  const currency = shop?.currency;
  const q = deliveryQuote.phase === "ready" ? deliveryQuote.quote : null;
  const priced = q && q.total !== null ? q : null;
  const loading = deliveryQuote.phase === "loading";

  const shownDiscount = priced ? Number(priced.discountAmount) : (discountAmount ?? 0);
  const showTax = priced ? Number(priced.taxAmount) > 0 : !taxQuote.empty;
  const gift = priced && giftCardAmount ? Math.max(0, Math.min(giftCardAmount, Number(priced.total))) : 0;

  let delivery: React.ReactNode;
  if (loading) {
    delivery = <span aria-busy="true" className="inline-block h-4 w-16 rounded bg-black/10 animate-pulse" />;
  } else if (deliveryQuote.phase === "error") {
    delivery = (
      <span className="text-red-600">
        Could not calculate.{" "}
        <button type="button" onClick={retryDeliveryQuote} className="underline cursor-pointer">
          Retry
        </button>
      </span>
    );
  } else if (q?.status === "unavailable") {
    delivery = <span className="text-red-600">Unavailable</span>;
  } else if (priced) {
    delivery = Number(priced.deliveryFee) === 0 ? "Free" : <Amount value={priced.deliveryFee ?? 0} currency={currency} />;
  } else if (orderType === "pickup") {
    delivery = "Free";
  } else {
    delivery = <span className="text-zinc-500">Calculated after you choose your address</span>;
  }

  return (
    <div className="pt-2 border-t border-black/10 space-y-1" data-testid="checkout-summary">
      <div className="flex items-center justify-between">
        <span className="text-zinc-600">Subtotal</span>
        <span>
          <Amount value={priced?.subtotal ?? subtotal} currency={currency} />
        </span>
      </div>
      {shownDiscount > 0 && (
        <div className="flex items-center justify-between text-green-600">
          <span>Discount</span>
          <span>
            -<Amount value={shownDiscount} currency={currency} />
          </span>
        </div>
      )}
      {showTax && (
        <div className="flex items-center justify-between">
          <span className="text-zinc-600">
            {shop?.taxInclusive ? "Includes tax" : "Tax"}
            {!priced && taxQuote.estimated ? " (estimated)" : ""}
          </span>
          <span>
            <Amount value={priced ? priced.taxAmount! : taxQuote.taxAmount} currency={currency} />
          </span>
        </div>
      )}
      <div className="flex items-center justify-between gap-3" data-testid="checkout-delivery-row">
        <span className="text-zinc-600">Delivery</span>
        <span className="text-end">{delivery}</span>
      </div>
      {q?.status === "unavailable" && q.reason && (
        <p role="alert" className="text-sm text-red-600" data-testid="checkout-delivery-reason">
          {q.reason}
        </p>
      )}
      {q?.status === "needs_address" && q.reason && (
        <p className="text-sm text-zinc-600" data-testid="checkout-delivery-reason">
          {q.reason}
        </p>
      )}
      <div className="flex items-center justify-between pt-1" data-testid="checkout-total-row">
        <span className="text-zinc-600">Total</span>
        <span className="font-medium">
          {loading ? (
            <span aria-busy="true" className="inline-block h-4 w-20 rounded bg-black/10 animate-pulse" />
          ) : priced ? (
            <span data-testid="checkout-total">
              <Amount value={priced.total!} currency={currency} />
            </span>
          ) : (
            <span className="text-zinc-500">To be confirmed</span>
          )}
        </span>
      </div>
      {gift > 0 && priced && (
        <>
          <div className="flex items-center justify-between text-green-600">
            <span>Gift card</span>
            <span>
              -<Amount value={gift} currency={currency} />
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-zinc-600">Amount due</span>
            <span className="font-medium">
              <Amount value={Math.max(0, Number(priced.total) - gift)} currency={currency} />
            </span>
          </div>
        </>
      )}
      {shop?.taxDisplayText && <p className="text-xs text-zinc-400">{shop.taxDisplayText}</p>}
    </div>
  );
}
