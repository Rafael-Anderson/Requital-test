"use client";

import type { CheckoutFormState } from "@/lib/useCheckoutForm";
import { storeButtonClassName } from "@/lib/button-style";
import { isDateBlocked } from "@/lib/slots";
import PromoCodeField from "@/components/PromoCodeField";
import GiftCardCodeField from "@/components/GiftCardCodeField";
import StoreCreditField from "@/components/StoreCreditField";
import DeliveryAddressFields from "./DeliveryAddressFields";
import FulfilmentSection, { FulfilmentUnavailable } from "./FulfilmentSection";
import CheckoutSummary from "./CheckoutSummary";
import PaymentMethodPicker from "./PaymentMethodPicker";
import DeliveryDateCalendar from "./DeliveryDateCalendar";
import TimeSlotPicker from "./TimeSlotPicker";
import { FIELD_CLASS, TEXTAREA_CLASS } from "./checkout-field-styles";

// The original checkout layout — every field on one long scroll. Kept as
// its own component (not inlined in the page) so it sits side by side with
// CheckoutSteps as two equally-real implementations of the same form state
// (see lib/useCheckoutForm.ts), per theme.checkoutLayout.
export default function CheckoutSinglePage(state: CheckoutFormState) {
  const {
    shop,
    quoteBlocked,
    orderType,
    selectedOutlet,
    customerName,
    setCustomerName,
    customerPhone,
    setCustomerPhone,
    customerEmail,
    setCustomerEmail,
    deliveryNotes,
    setDeliveryNotes,
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

  if (state.fulfilment.mode === "none") return <FulfilmentUnavailable state={state} />;

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <h1 className="text-2xl font-semibold">Checkout</h1>

      <FulfilmentSection state={state} />

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

      {orderType === "delivery" && <DeliveryAddressFields state={state} />}
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-medium block mb-1">{orderType === "pickup" ? "Pickup date (optional)" : "Delivery date (optional)"}</label>
          <DeliveryDateCalendar
            value={deliveryDate}
            onChange={setDeliveryDate}
            minDate={minDate}
            isDateGrayedOut={(d) =>
              isDateBlocked(d, new Date(`${minDate}T00:00:00`), shop?.allowSameDayOrders, shop?.allowNextDayOrders) ||
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

      <div>
        <label htmlFor="checkout-notes" className="text-sm font-medium block mb-1">Notes (optional)</label>
        <textarea id="checkout-notes" value={deliveryNotes} onChange={(e) => setDeliveryNotes(e.target.value)} rows={2} className={TEXTAREA_CLASS} />
      </div>

      <div>
        <p className="text-sm font-medium mb-2">Payment</p>
        <PaymentMethodPicker methods={availablePaymentMethods} value={paymentMethod} onChange={setPaymentMethod} />
      </div>

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

      <CheckoutSummary state={state} />

      {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        {state.blockedReason && <p className="text-sm text-zinc-600">{state.blockedReason}</p>}

      <button
        type="submit"
        disabled={!state.canSubmit}
        className={`w-full h-11 font-medium ${storeButtonClassName(shop)}`}
      >
        {submitting ? "Placing order…" : "Place order"}
      </button>
    </form>
  );
}
