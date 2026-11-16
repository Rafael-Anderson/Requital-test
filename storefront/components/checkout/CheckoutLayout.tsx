"use client";

import Link from "next/link";
import type { CheckoutFormState } from "@/lib/useCheckoutForm";
import { useShop } from "@/lib/shop-context";
import { useAuth } from "@/lib/auth";
import { storeButtonClassName } from "@/lib/button-style";
import { isDateBlocked } from "@/lib/slots";
import { focusField, missingRequiredFields } from "@/lib/checkout-validation";
import PromoCodeField from "@/components/PromoCodeField";
import GiftCardCodeField from "@/components/GiftCardCodeField";
import StoreCreditField from "@/components/StoreCreditField";
import DeliveryAddressFields from "./DeliveryAddressFields";
import FulfilmentSection, { FulfilmentUnavailable } from "./FulfilmentSection";
import CheckoutSummary, { CheckoutTotalCompact } from "./CheckoutSummary";
import CheckoutOrderItems from "./CheckoutOrderItems";
import PaymentMethodPicker from "./PaymentMethodPicker";
import DeliveryDateCalendar from "./DeliveryDateCalendar";
import TimeSlotPicker from "./TimeSlotPicker";
import { FIELD_CLASS, TEXTAREA_CLASS } from "./checkout-field-styles";

// The checkout: ONE page, two columns from the lg breakpoint, one column below it.
//
//   left   who you are, where it goes and when (details, fulfilment, address,
//          receiver and gift message, date and slot, notes)
//   right  the order: items, codes and credit, the bill, payment, Place order.
//          A sticky card on desktop only; on a phone and a tablet it follows the
//          details, so the total and the button are the last thing on the page.
//
// There is exactly one copy of everything in the DOM (the columns are a CSS grid,
// not two renderings), so a phone and a desktop run the same markup, the same
// state (useCheckoutForm) and the same submit. All logical properties, so it
// mirrors in RTL.
export default function CheckoutLayout(state: CheckoutFormState) {
  const {
    shop,
    orderType,
    customerName,
    setCustomerName,
    customerPhone,
    setCustomerPhone,
    customerEmail,
    setCustomerEmail,
    deliveryNotes,
    setDeliveryNotes,
    receiverMessage,
    setReceiverMessage,
    receiverIsOther,
    setReceiverIsOther,
    receiverName,
    setReceiverName,
    receiverPhone,
    setReceiverPhone,
    deliveryDate,
    setDeliveryDate,
    deliveryTimeSlot,
    setDeliveryTimeSlot,
    paymentMethod,
    setPaymentMethod,
    availablePaymentMethods,
    submitting,
    error,
    handleSubmit,
    minDate,
    timeSlots,
    dateIsToday,
    dateBlocked,
    todayFullyBooked,
  } = state;
  const { shopBasePath, regions, regionLabel } = useShop();
  const { customer } = useAuth();

  const missing = missingRequiredFields({
    orderType,
    customerName,
    customerPhone,
    customerAddress: state.customerAddress,
    regionId: state.regionId,
    hasRegions: (regions ?? []).length > 0,
    regionLabel: regionLabel ?? "Region",
    receiverIsOther,
    receiverName,
    receiverPhone,
  });

  if (state.fulfilment.mode === "none") return <FulfilmentUnavailable state={state} />;

  const isPickup = orderType === "pickup";
  const disabled = !state.canSubmit || missing.length > 0;

  return (
    <div>
      <h1 className="text-2xl font-semibold">Checkout</h1>
      <form
        onSubmit={handleSubmit}
        className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:items-start"
        data-testid="checkout-form"
      >
        <div className="min-w-0 space-y-8" data-testid="checkout-details">
          <section aria-labelledby="checkout-details-title" className="space-y-4">
            <h2 id="checkout-details-title" className="text-lg font-semibold">
              Your details
            </h2>
            {customer ? (
              <p className="text-sm text-zinc-600" data-testid="checkout-account-note">
                Signed in as {customer.name}.
              </p>
            ) : (
              <p className="text-sm text-zinc-600" data-testid="checkout-account-note">
                Checking out as a guest.{" "}
                <Link href={`${shopBasePath}/account/login`} className="underline text-accent-text">
                  Sign in
                </Link>{" "}
                to use your saved details and addresses.
              </p>
            )}
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="checkout-name" className="text-sm font-medium block mb-1">Name</label>
                <input id="checkout-name" autoComplete="name" required value={customerName} onChange={(e) => setCustomerName(e.target.value)} className={FIELD_CLASS} />
              </div>
              <div>
                <label htmlFor="checkout-phone" className="text-sm font-medium block mb-1">Phone</label>
                <input
                  id="checkout-phone"
                  autoComplete="tel"
                  required
                  type="tel"
                  inputMode="tel"
                  maxLength={20}
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  onBlur={state.notifyAbandonedCart}
                  className={FIELD_CLASS}
                />
              </div>
            </div>
            <div>
              <label htmlFor="checkout-email" className="text-sm font-medium block mb-1">Email (optional)</label>
              <input id="checkout-email" autoComplete="email" type="email" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} className={FIELD_CLASS} />
            </div>
          </section>

          <section aria-labelledby="checkout-fulfilment-title" className="space-y-4">
            <h2 id="checkout-fulfilment-title" className="text-lg font-semibold">
              {isPickup ? "Pickup" : "Delivery"}
            </h2>
            <FulfilmentSection state={state} />
            {orderType === "delivery" && <DeliveryAddressFields state={state} />}
            {/* The receiver: who gets it, when that is not the customer. Unticked, the
                customer above is the receiver and nothing here is stored or sent. */}
            <div className="space-y-3" data-testid="checkout-receiver">
              <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                <input
                  id="checkout-receiver-other"
                  type="checkbox"
                  checked={receiverIsOther}
                  onChange={(e) => setReceiverIsOther(e.target.checked)}
                  className="size-4 accent-accent"
                />
                Receiver is someone else
              </label>
              {receiverIsOther && (
                <div className="grid sm:grid-cols-2 gap-3" data-testid="checkout-receiver-fields">
                  <div>
                    <label htmlFor="checkout-receiver-name" className="text-sm font-medium block mb-1">Receiver name</label>
                    <input
                      id="checkout-receiver-name"
                      autoComplete="off"
                      required
                      maxLength={191}
                      value={receiverName}
                      onChange={(e) => setReceiverName(e.target.value)}
                      className={FIELD_CLASS}
                    />
                  </div>
                  <div>
                    <label htmlFor="checkout-receiver-phone" className="text-sm font-medium block mb-1">Receiver phone</label>
                    <input
                      id="checkout-receiver-phone"
                      autoComplete="off"
                      required
                      type="tel"
                      inputMode="tel"
                      maxLength={20}
                      value={receiverPhone}
                      onChange={(e) => setReceiverPhone(e.target.value)}
                      className={FIELD_CLASS}
                    />
                  </div>
                </div>
              )}
              {/* The gift message belongs to the receiver (order.receiverMessage), so it sits with them. */}
              <div>
                <label htmlFor="checkout-gift-message" className="text-sm font-medium block mb-1">Gift message (optional)</label>
                <textarea
                  id="checkout-gift-message"
                  value={receiverMessage}
                  onChange={(e) => setReceiverMessage(e.target.value)}
                  rows={2}
                  maxLength={500}
                  className={TEXTAREA_CLASS}
                />
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium block mb-1">{isPickup ? "Pickup date (optional)" : "Delivery date (optional)"}</label>
                <DeliveryDateCalendar
                  value={deliveryDate}
                  onChange={setDeliveryDate}
                  minDate={minDate}
                  isDateGrayedOut={(d) =>
                    isDateBlocked(d, minDate, shop?.allowSameDayOrders, shop?.allowNextDayOrders) ||
                    (d === minDate && todayFullyBooked)
                  }
                />
                {dateBlocked ? (
                  <p className="text-xs text-red-600 mt-1">
                    {dateIsToday ? "Same-day orders aren't available right now." : "Next-day orders aren't available right now."}
                  </p>
                ) : (
                  dateIsToday &&
                  todayFullyBooked && <p className="text-xs text-red-600 mt-1">No time slots left today. Pick another date.</p>
                )}
              </div>
              {deliveryDate && (
                <div>
                  <label className="text-sm font-medium block mb-1">Time slot</label>
                  <TimeSlotPicker slots={timeSlots} value={deliveryTimeSlot} onChange={setDeliveryTimeSlot} />
                </div>
              )}
            </div>
          </section>

          <section aria-labelledby="checkout-notes-title" className="space-y-4">
            <h2 id="checkout-notes-title" className="text-lg font-semibold">
              Notes
            </h2>
            <div>
              <label htmlFor="checkout-notes" className="text-sm font-medium block mb-1">Notes (optional)</label>
              <textarea id="checkout-notes" value={deliveryNotes} onChange={(e) => setDeliveryNotes(e.target.value)} rows={2} className={TEXTAREA_CLASS} />
            </div>
          </section>
        </div>

        <aside
          aria-labelledby="checkout-summary-title"
          data-testid="checkout-summary-column"
          className="min-w-0 space-y-5 rounded-2xl border border-stroke bg-background p-5 lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto"
        >
          <h2 id="checkout-summary-title" className="text-lg font-semibold">
            Order summary
          </h2>
          <CheckoutOrderItems items={state.items} currency={shop?.currency} />

          <div className="space-y-4 border-t border-black/10 pt-4">
            <div>
              <p className="text-sm font-medium mb-2">Promo code</p>
              <PromoCodeField
                shopSlug={state.shopSlug}
                productIds={state.items.map((i) => i.productId)}
                onAmountChange={(amount) => state.setDiscountAmount(amount)}
              />
            </div>
            <div>
              <p className="text-sm font-medium mb-2">Gift card</p>
              <GiftCardCodeField shopSlug={state.shopSlug} onAmountChange={(amount) => state.setGiftCardAmount(amount)} />
            </div>
            <StoreCreditField
              shopSlug={state.shopSlug}
              currency={state.shop?.currency}
              checked={state.useStoreCredit}
              onChange={state.setUseStoreCredit}
            />
          </div>

          <CheckoutSummary state={state} />

          <div>
            <p className="text-sm font-medium mb-2">Payment</p>
            <PaymentMethodPicker
              methods={availablePaymentMethods}
              value={paymentMethod}
              onChange={setPaymentMethod}
              cardProcessor={shop?.cardProcessor}
              stacked
            />
          </div>

          <div className="space-y-3">
            {/* Below lg the summary above has scrolled away by the time the shopper
                reaches the button, so the total is repeated right above it. */}
            <CheckoutTotalCompact state={state} />
            {error && (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            )}
            {state.blockedReason && <p className="text-sm text-zinc-600">{state.blockedReason}</p>}
            {missing.length > 0 && !submitting && (
              <p className="text-sm text-zinc-600" data-testid="checkout-missing">
                Still needed:{" "}
                {missing.map((m, i) => (
                  <span key={m.id}>
                    {i > 0 && ", "}
                    <button type="button" onClick={() => focusField(m.id)} className="underline cursor-pointer text-accent-text">
                      {m.label.toLowerCase()}
                    </button>
                  </span>
                ))}
              </p>
            )}
            <button
              type="submit"
              disabled={disabled}
              className={`w-full h-11 font-medium ${storeButtonClassName(shop)}`}
            >
              {submitting ? "Placing order…" : "Place order"}
            </button>
          </div>
        </aside>
      </form>
    </div>
  );
}
