"use client";

import type { CheckoutFormState } from "@/lib/useCheckoutForm";
import { EMIRATES } from "@/lib/types";
import { storeButtonClassName } from "@/lib/button-style";
import PromoCodeField from "@/components/PromoCodeField";
import GiftCardCodeField from "@/components/GiftCardCodeField";
import { FIELD_CLASS, COMPACT_FIELD_CLASS, TEXTAREA_CLASS, BUTTON_OUTLINE_CLASS, PAYMENT_LABELS } from "./checkout-field-styles";

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
    customerAddress,
    setCustomerAddress,
    emirate,
    setEmirate,
    area,
    setArea,
    coords,
    locating,
    useMyLocation,
    addressQuery,
    setAddressQuery,
    searching,
    searchAddress,
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
    savedAddresses,
    applySavedAddress,
    handleSubmit,
    minDate,
    timeSlots,
    dateIsToday,
    dateBlocked,
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
                  : "border-black/15 dark:border-white/15 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300"
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
                  : "border-black/15 dark:border-white/15 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300"
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

      {orderType === "delivery" && (
        <div className="space-y-3 rounded-lg border border-black/10 dark:border-white/10 p-4">
          <p className="text-sm font-medium">Delivery address</p>
          {savedAddresses.length > 0 && (
            <div>
              <label className="text-sm font-medium block mb-1">Use a saved address</label>
              <select
                defaultValue=""
                onChange={(e) => {
                  const selected = savedAddresses.find((a) => a.id === e.target.value);
                  if (selected) applySavedAddress(selected);
                }}
                className={FIELD_CLASS}
              >
                <option value="">— Choose a saved address —</option>
                {savedAddresses.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label ? `${a.label} — ` : ""}
                    {a.address}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={useMyLocation}
              disabled={locating}
              className={`h-9 px-3 rounded-lg text-sm cursor-pointer disabled:opacity-50 ${BUTTON_OUTLINE_CLASS}`}
            >
              {locating ? "Locating…" : "📍 Use my location"}
            </button>
            {coords && <span className="text-xs text-zinc-500 self-center">Location captured</span>}
          </div>
          <div className="flex gap-2">
            <input
              value={addressQuery}
              onChange={(e) => setAddressQuery(e.target.value)}
              placeholder="Or search your address"
              className={COMPACT_FIELD_CLASS}
            />
            <button
              type="button"
              onClick={searchAddress}
              disabled={searching}
              className={`h-9 px-3 rounded-lg text-sm cursor-pointer disabled:opacity-50 ${BUTTON_OUTLINE_CLASS}`}
            >
              {searching ? "Searching…" : "Search"}
            </button>
          </div>
          <div>
            <label className="text-sm font-medium block mb-1">Full address</label>
            <textarea required value={customerAddress} onChange={(e) => setCustomerAddress(e.target.value)} rows={2} className={TEXTAREA_CLASS} />
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
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
            <div>
              <label className="text-sm font-medium block mb-1">Area (optional)</label>
              <input value={area} onChange={(e) => setArea(e.target.value)} className={FIELD_CLASS} />
            </div>
          </div>
        </div>
      )}
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
          <input type="date" min={minDate} value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} className={FIELD_CLASS} />
          {dateBlocked && (
            <p className="text-xs text-red-600 mt-1">
              {dateIsToday ? "Same-day orders aren't available right now." : "Next-day orders aren't available right now."}
            </p>
          )}
        </div>
        <div>
          <label className="text-sm font-medium block mb-1">Time slot (optional)</label>
          <select value={deliveryTimeSlot} onChange={(e) => setDeliveryTimeSlot(e.target.value)} className={FIELD_CLASS}>
            <option value="">No preference</option>
            {timeSlots.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="text-sm font-medium block mb-1">Notes (optional)</label>
        <textarea value={deliveryNotes} onChange={(e) => setDeliveryNotes(e.target.value)} rows={2} className={TEXTAREA_CLASS} />
      </div>

      <div>
        <p className="text-sm font-medium mb-2">Payment</p>
        <div className="space-y-2">
          {availablePaymentMethods.map((m) => (
            <label key={m} className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="radio" name="paymentMethod" checked={paymentMethod === m} onChange={() => setPaymentMethod(m)} />
              {PAYMENT_LABELS[m]}
            </label>
          ))}
        </div>
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

      <div className="pt-2 border-t border-black/10 dark:border-white/10 space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-zinc-600">Subtotal</span>
          <span>
            {subtotal.toFixed(2)} {shop?.currency}
          </span>
        </div>
        {discountAmount !== null && discountAmount > 0 && (
          <div className="flex items-center justify-between text-green-600 dark:text-green-400">
            <span>Discount</span>
            <span>
              -{discountAmount.toFixed(2)} {shop?.currency}
            </span>
          </div>
        )}
        {giftCardAmount !== null && giftCardAmount > 0 && (
          <div className="flex items-center justify-between text-green-600 dark:text-green-400">
            <span>Gift card</span>
            <span>
              -{Math.max(0, Math.min(giftCardAmount, subtotal - (discountAmount ?? 0))).toFixed(2)} {shop?.currency}
            </span>
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-zinc-600">Total (before delivery/tax)</span>
          <span className="font-medium">
            {total.toFixed(2)} {shop?.currency}
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
