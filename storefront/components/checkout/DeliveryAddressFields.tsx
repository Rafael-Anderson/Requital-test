"use client";

import type { CheckoutFormState } from "@/lib/useCheckoutForm";
import { EMIRATES } from "@/lib/types";
import MapPicker from "@/components/MapPicker";
import { FIELD_CLASS, TEXTAREA_CLASS, BUTTON_OUTLINE_CLASS } from "./checkout-field-styles";

// The "delivery address" card — identical in CheckoutSinglePage and
// CheckoutSteps (only the surrounding step chrome differs), pulled out here
// so the map integration exists in exactly one place.
export default function DeliveryAddressFields({ state }: { state: CheckoutFormState }) {
  const {
    customerAddress,
    setCustomerAddress,
    emirate,
    setEmirate,
    area,
    setArea,
    coords,
    setCoords,
    locating,
    useMyLocation,
    savedAddresses,
    applySavedAddress,
  } = state;

  return (
    <div className="space-y-3 rounded-lg border border-black/10 p-4">
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
            <option value="">Choose a saved address</option>
            {savedAddresses.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label ? `${a.label}: ` : ""}
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
      <MapPicker
        latitude={coords?.latitude ?? null}
        longitude={coords?.longitude ?? null}
        onPick={(picked, address) => {
          setCoords(picked);
          if (address) setCustomerAddress(address);
        }}
      />
      <div>
        <label className="text-sm font-medium block mb-1">Full address</label>
        <textarea
          required
          value={customerAddress}
          onChange={(e) => setCustomerAddress(e.target.value)}
          rows={2}
          className={TEXTAREA_CLASS}
        />
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
  );
}
