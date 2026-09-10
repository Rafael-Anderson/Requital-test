// Shop-wide settings that are editable from inside an OUTLET's edit page.
//
// The outlet tabs (OutletBasicInfoTab / OutletDeliveryTab / OutletPickupTab)
// each call BOTH updateOutlet() and updateShop() — 4, 11 and 7 shop-wide
// fields respectively. A merchant with three branches sees the same control
// on three pages and changing it on one changes it everywhere.
//
// THREE of the five cards carrying these fields already say so in static
// hint copy ("These apply shop-wide, across every outlet, not just this
// one"): Basic Info's "Order Setting", Delivery's "Delivery Settings" and
// Pickup's "Pickup Settings". TWO do not -- Delivery's "Operation Settings"
// (8 of that tab's 11 fields) and Pickup's "Preparation Time Settings" (3 of
// its 7) -- and each unhinted card sits directly below a hinted one AND
// shares its Save button, so reading the hint actively misleads about the
// card underneath it.
//
// So this is a strengthening of partial coverage, not a fill of total
// absence. What the hint cannot do even where it exists: it is the faintest
// text style in the design system, it sits above a long card, and it is
// passive -- it never speaks at the moment a value actually changes. This
// module backs a confirm dialog that fires only when a shop-wide value has
// ACTUALLY changed.
//
// STOPGAP, not the fix. The real fix is docs/plans/product-capability-audit.md
// §14 — move these fields out of the outlet pages entirely into
// Settings > Selling > Money & Tax and Settings > Fulfilment. This module and
// its modal are deleted by that work, not extended.

// Labels are the merchant-facing control labels as rendered on the outlet
// tabs, not column names. Several columns intentionally share one label
// because the merchant sees them as one control (the three payment-method
// checkboxes; the three estimated-delivery-time inputs) — diffShopWideChanges
// de-duplicates, so changing two of the three still reads as one line.
export const SHOP_WIDE_FIELD_LABELS: Record<string, string> = {
  // OutletBasicInfoTab > "Order Setting"
  allowSameDayOrders: "Same-day orders",
  allowNextDayOrders: "Next-day orders",
  taxRate: "Tax Rate (%)",
  taxInclusive: "Tax Type",

  // OutletDeliveryTab > "Delivery Settings"
  deliveryPaymentCardOnline: "Delivery payment methods",
  deliveryPaymentCashOnDelivery: "Delivery payment methods",
  deliveryPaymentCardOnDelivery: "Delivery payment methods",
  deliveryHours: "Opening Hours for Delivery",

  // OutletDeliveryTab > "Operation Settings"
  deliveryTimeSlotGapMinutes: "Time Slot Gap",
  deliveryPreparationTimeMinutes: "Preparation Time",
  deliveryPreparationPlusDeliveryTimeMinutes: "Preparation + Delivery Time",
  estimatedDeliveryTimeFrom: "Estimated Delivery Time",
  estimatedDeliveryTimeTo: "Estimated Delivery Time",
  estimatedDeliveryTimeUnit: "Estimated Delivery Time",
  sameDayCutoffTime: "Same-day order cutoff",

  // OutletPickupTab > "Pickup Settings"
  pickupPaymentCardOnline: "Pickup payment methods",
  pickupPaymentCashOnPickup: "Pickup payment methods",
  pickupPaymentCardOnPickup: "Pickup payment methods",
  pickupHours: "Opening Hours for Pickup",

  // OutletPickupTab > "Preparation Time Settings"
  pickupTimeSlotGapMinutes: "Time Slot Gap",
  pickupPreparationTimeMinutes: "Preparation Time",
  pickupPreparationPlusTimeMinutes: "Preparation + Pickup Time",
};

// Compare the payload a tab is about to send against the payload it loaded,
// and return the merchant-facing labels of what actually changed (deduped,
// in SHOP_WIDE_FIELD_LABELS order so the list reads consistently).
//
// Both sides are the SAME shape — each tab builds its updateShop() payload
// first and diffs that against the payload form of what getShop() returned —
// so there is no string-vs-number mismatch to guard against (taxRate is a
// string in form state but a number in both payloads).
//
// ponytail: JSON.stringify comparison, which is only sound because the one
// non-scalar value here (deliveryHours / pickupHours) always comes through
// mergeBusinessHours()/defaultBusinessHours(), which build it from one fixed
// literal and therefore a stable key order. If a future field carries an
// object assembled some other way, give it a real comparator.
export function diffShopWideChanges(
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
): string[] {
  // No baseline yet (the shop fetch has not resolved) means we cannot prove
  // anything changed, so every shop-wide key in the payload is reported.
  // Warn rather than stay silent: a false prompt is a click, a missed one is
  // a shop-wide change the merchant did not intend.
  // Iterate the label map, not the payload, so the list always reads in the
  // order the controls appear on the page regardless of how a tab happens to
  // build its payload object.
  const changed = Object.keys(SHOP_WIDE_FIELD_LABELS).filter((key) => {
    if (!(key in after)) return false;
    if (before === null) return true;
    return JSON.stringify(before[key]) !== JSON.stringify(after[key]);
  });

  return dedupe(changed.map((key) => SHOP_WIDE_FIELD_LABELS[key]));
}

function dedupe(labels: string[]): string[] {
  return [...new Set(labels)];
}
