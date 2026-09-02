"use client";

import type { CheckoutFormState } from "@/lib/useCheckoutForm";
import { EMIRATES } from "@/lib/types";
import { storeButtonClassName } from "@/lib/button-style";
import { isDateBlocked } from "@/lib/slots";
import PromoCodeField from "@/components/PromoCodeField";
import GiftCardCodeField from "@/components/GiftCardCodeField";
import DeliveryAddressFields from "./DeliveryAddressFields";
import PaymentMethodPicker from "./PaymentMethodPicker";
import DeliveryDateCalendar from "./DeliveryDateCalendar";
import TimeSlotPicker from "./TimeSlotPicker";
import { FIELD_CLASS, TEXTAREA_CLASS } from "./checkout-field-styles";
import CurrencySymbol from "@/components/CurrencySymbol";

// The original checkout layout — every field on one long scroll. Kept as
// its own component (not inlined in the page) so it sits side by side with
// CheckoutSteps as two equally-real implementations of the same form state
// (see lib/useCheckoutForm.ts), per theme.checkoutLayout.
export default function CheckoutSinglePage(state: CheckoutFormState) {
  const {
    shop,
    total,
    subtotal,
    discountAmount,
    giftCardAmount,
    orderType,
    setOrderType,
    deliveryAvailable,
    pickupAvailable,
    outletOptions,
    outletId,
    setOutletId,
    selectedOutlet,
    customerName,
    setCustomerName,
    customerPhone,
    setCustomerPhone,
    customerEmail,
    setCustomerEmail,
    emirate,
    setEmirate,
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

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <h1 className="text-2xl font-semibold">Checkout</h1>

      <div>
        <p className="text-sm font-medium mb-2">Fulfillment</p>
        <div className="flex gap-2">
          {deliveryAvailable && (
            <button
              type="button"
              onClick={() => setOrderType("delivery")}
              className={`flex-1 h-10 rounded-lg border font-medium cursor-pointer transition-colors ${
                orderType === "delivery"
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-black/15 bg-white text-zinc-600"
              }`}
            >
              Delivery
            </button>
          )}
          {pickupAvailable && (
            <button
              type="button"
              onClick={() => setOrderType("pickup")}
              className={`flex-1 h-10 rounded-lg border font-medium cursor-pointer transition-colors ${
                orderType === "pickup"
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-black/15 bg-white text-zinc-600"
              }`}
            >
              Pickup
            </button>
          )}
        </div>
      </div>

      {outletOptions.length > 1 && (
        <div>
          <label className="text-sm font-medium block mb-1">
            {orderType === "pickup" ? "Pickup location" : "Branch"}
          </label>
          <select value={outletId ?? ""} onChange={(e) => setOutletId(Number(e.target.value))} className={FIELD_CLASS}>
            {outletOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} {o.isOpen ? "" : "(closed)"}
              </option>
            ))}
          </select>
        </div>
      )}
      {selectedOutlet && !selectedOutlet.isOpen && (
        <p className="text-sm text-red-600">This location is currently closed.</p>
      )}

      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-medium block mb-1">Name</label>
          <input required value={customerName} onChange={(e) => setCustomerName(e.target.value)} className={FIELD_CLASS} />
        </div>
        <div>
          <label className="text-sm font-medium block mb-1">Phone</label>
          <input
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
        <label className="text-sm font-medium block mb-1">Email (optional)</label>
        <input type="email" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} className={FIELD_CLASS} />
      </div>

      {orderType === "delivery" && <DeliveryAddressFields state={state} />}
      {orderType === "pickup" && (
        <div>
          <label className="text-sm font-medium block mb-1">Emirate</label>
          <select value={emirate} onChange={(e) => setEmirate(e.target.value)} className={FIELD_CLASS}>
            {EMIRATES.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </div>
      )}

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
            todayFullyBooked && <p className="text-xs text-red-600 mt-1">No time slots left today — pick another date.</p>
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
        <label className="text-sm font-medium block mb-1">Notes (optional)</label>
        <textarea value={deliveryNotes} onChange={(e) => setDeliveryNotes(e.target.value)} rows={2} className={TEXTAREA_CLASS} />
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

      <div className="pt-2 border-t border-black/10 space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-zinc-600">Subtotal</span>
          <span>
            {subtotal.toFixed(2)} <CurrencySymbol code={shop?.currency} />
          </span>
        </div>
        {discountAmount !== null && discountAmount > 0 && (
          <div className="flex items-center justify-between text-green-600">
            <span>Discount</span>
            <span>
              -{discountAmount.toFixed(2)} <CurrencySymbol code={shop?.currency} />
            </span>
          </div>
        )}
        {giftCardAmount !== null && giftCardAmount > 0 && (
          <div className="flex items-center justify-between text-green-600">
            <span>Gift card</span>
            <span>
              -{Math.max(0, Math.min(giftCardAmount, subtotal - (discountAmount ?? 0))).toFixed(2)} <CurrencySymbol code={shop?.currency} />
            </span>
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-zinc-600">Total (before delivery/tax)</span>
          <span className="font-medium">
            {total.toFixed(2)} <CurrencySymbol code={shop?.currency} />
          </span>
        </div>
      </div>
      {shop?.taxDisplayText && <p className="text-xs text-zinc-400">{shop.taxDisplayText}</p>}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={submitting || !orderType || !paymentMethod || dateBlocked || (selectedOutlet ? !selectedOutlet.isOpen : true)}
        className={`w-full h-11 font-medium ${storeButtonClassName(shop)}`}
      >
        {submitting ? "Placing order…" : "Place order"}
      </button>
    </form>
  );
}
