"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import type { CheckoutFormState } from "@/lib/useCheckoutForm";
import { EMIRATES } from "@/lib/types";
import { storeButtonClassName } from "@/lib/button-style";
import PromoCodeField from "@/components/PromoCodeField";
import GiftCardCodeField from "@/components/GiftCardCodeField";
import DeliveryAddressFields from "./DeliveryAddressFields";
import { FIELD_CLASS, TEXTAREA_CLASS, BUTTON_OUTLINE_CLASS, PAYMENT_LABELS } from "./checkout-field-styles";

const STEPS = ["Contact", "Delivery", "Payment"] as const;

function StepHeader({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-2 mb-6">
      {STEPS.map((label, i) => (
        <div key={label} className="flex items-center gap-2 flex-1 last:flex-none">
          <div className="flex items-center gap-2">
            <span
              className={`flex items-center justify-center size-6 rounded-full text-xs font-medium shrink-0 ${
                i < step ? "bg-accent text-accent-foreground" : i === step ? "border-2 border-accent text-accent" : "border border-black/15 dark:border-white/15 text-zinc-400"
              }`}
            >
              {i < step ? <Check className="size-3.5" /> : i + 1}
            </span>
            <span className={`text-sm font-medium ${i === step ? "text-product-name" : "text-zinc-400"}`}>{label}</span>
          </div>
          {i < STEPS.length - 1 && <div className={`flex-1 h-px ${i < step ? "bg-accent" : "bg-black/10 dark:bg-white/10"}`} />}
        </div>
      ))}
    </div>
  );
}

// Same form fields and the same useCheckoutForm() submission logic as
// CheckoutSinglePage — this is presentation-only, no separate validation or
// order-creation path. Contact -> Delivery -> Payment, one screen at a
// time, with a review of the order total carried onto the final step.
export default function CheckoutSteps(state: CheckoutFormState) {
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
  } = state;

  const [step, setStep] = useState(0);

  const contactValid = !!customerName.trim() && !!customerPhone.trim();
  const deliveryValid = orderType === "pickup" ? true : customerAddress.trim().length > 0;

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">Checkout</h1>
      <StepHeader step={step} />

      <form onSubmit={handleSubmit} className="space-y-6">
        {step === 0 && (
          <div className="space-y-4">
            <div>
              <p className="text-sm font-medium mb-2">Fulfillment</p>
              <div className="flex gap-2">
                {deliveryAvailable && (
                  <button
                    type="button"
                    onClick={() => setOrderType("delivery")}
                    className={`flex-1 h-10 rounded-lg border font-medium cursor-pointer transition-colors ${
                      orderType === "delivery" ? "border-accent bg-accent/10 text-accent" : "border-black/15 dark:border-white/15 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300"
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
                      orderType === "pickup" ? "border-accent bg-accent/10 text-accent" : "border-black/15 dark:border-white/15 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300"
                    }`}
                  >
                    Pickup
                  </button>
                )}
              </div>
            </div>

            {outletOptions.length > 1 && (
              <div>
                <label className="text-sm font-medium block mb-1">{orderType === "pickup" ? "Pickup location" : "Branch"}</label>
                <select value={outletId ?? ""} onChange={(e) => setOutletId(Number(e.target.value))} className={FIELD_CLASS}>
                  {outletOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name} {o.isOpen ? "" : "(closed)"}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {selectedOutlet && !selectedOutlet.isOpen && <p className="text-sm text-red-600">This location is currently closed.</p>}

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
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
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
                <input type="date" min={minDate} value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} className={FIELD_CLASS} />
                {dateBlocked && (
                  <p className="text-xs text-red-600 mt-1">{dateIsToday ? "Same-day orders aren't available right now." : "Next-day orders aren't available right now."}</p>
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
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
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
              <PromoCodeField shopSlug={state.shopSlug} productIds={state.items.map((i) => i.productId)} onAmountChange={(amount) => state.setDiscountAmount(amount)} />
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
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-3">
          {step > 0 && (
            <button type="button" onClick={() => setStep((s) => s - 1)} className={`h-11 px-5 rounded-lg text-sm font-medium cursor-pointer ${BUTTON_OUTLINE_CLASS}`}>
              Back
            </button>
          )}
          {step < STEPS.length - 1 ? (
            <button
              type="button"
              onClick={() => setStep((s) => s + 1)}
              disabled={(step === 0 && !contactValid) || (step === 1 && !deliveryValid)}
              className={`flex-1 h-11 font-medium disabled:cursor-not-allowed ${storeButtonClassName(shop)}`}
            >
              Continue
            </button>
          ) : (
            <button
              type="submit"
              disabled={submitting || !orderType || !paymentMethod || dateBlocked || (selectedOutlet ? !selectedOutlet.isOpen : true)}
              className={`flex-1 h-11 font-medium ${storeButtonClassName(shop)}`}
            >
              {submitting ? "Placing order…" : "Place order"}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
