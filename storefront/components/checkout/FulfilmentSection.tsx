"use client";

import type { CheckoutFormState } from "@/lib/useCheckoutForm";
import { fulfilmentUnavailableMessage } from "@/lib/fulfilment";
import { storeButtonClassName } from "@/lib/button-style";
import { FIELD_CLASS } from "./checkout-field-styles";

// Shown instead of the whole form when nothing can be ordered. The button is
// rendered (disabled) so the shopper sees why, not a page with no way forward.
export function FulfilmentUnavailable({ state }: { state: CheckoutFormState }) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Checkout</h1>
      <p role="alert" className="text-sm text-red-600">
        {fulfilmentUnavailableMessage(state.fulfilment.reason)}
      </p>
      <button type="button" disabled className={`w-full h-11 font-medium ${storeButtonClassName(state.shop)}`}>
        Place order
      </button>
    </div>
  );
}

// The Delivery / Pickup choice, the branch picker and, for pickup, where to
// collect. The Delivery / Pickup buttons exist only when the selected outlet
// offers both; a single option is applied with no control (the fields below
// already show only what that option needs). Shared by both checkout layouts.
export default function FulfilmentSection({ state }: { state: CheckoutFormState }) {
  const { fulfilment, orderType, setOrderType, outletOptions, outletId, setOutletId, selectedOutlet } = state;
  return (
    <>
      {fulfilment.mode === "both" && (
        <div>
          <p className="text-sm font-medium mb-2">Fulfillment</p>
          <div className="flex gap-2">
            {(["delivery", "pickup"] as const).map((type) => (
              <button
                key={type}
                type="button"
                aria-pressed={orderType === type}
                onClick={() => setOrderType(type)}
                className={`flex-1 h-10 rounded-lg border font-medium cursor-pointer transition-colors ${
                  orderType === type ? "border-accent bg-accent/10 text-accent-text" : "border-black/15 bg-white text-zinc-600"
                }`}
              >
                {type === "delivery" ? "Delivery" : "Pickup"}
              </button>
            ))}
          </div>
        </div>
      )}

      {outletOptions.length > 1 && (
        <div>
          <label className="text-sm font-medium block mb-1">{orderType === "pickup" ? "Pickup location" : "Branch"}</label>
          <select value={outletId ?? ""} onChange={(e) => setOutletId(Number(e.target.value))} className={FIELD_CLASS}>
            {outletOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
                {o.deliveryEnabled && o.pickupEnabled ? "" : o.pickupEnabled ? " (pickup only)" : " (delivery only)"}
                {o.isOpen ? "" : " (closed)"}
              </option>
            ))}
          </select>
        </div>
      )}
      {selectedOutlet && !selectedOutlet.isOpen && <p className="text-sm text-red-600">This location is currently closed.</p>}

      {orderType === "pickup" && selectedOutlet && (
        <div data-testid="pickup-details" className="rounded-lg border border-black/10 p-4 text-sm space-y-1">
          <p className="font-medium">Pickup from</p>
          <p>{selectedOutlet.name}</p>
          {selectedOutlet.area && <p className="text-zinc-600">{selectedOutlet.area}</p>}
          {selectedOutlet.phone && <p className="text-zinc-600">{selectedOutlet.phone}</p>}
        </div>
      )}
    </>
  );
}
