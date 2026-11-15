// What the checkout still needs from the shopper before an order can be placed, in
// the order the fields appear on the page. The ids are the DOM ids of the controls,
// so the page can send the shopper straight to the first one that is missing.
//
// This mirrors what the browser's own `required` attributes already enforced (name,
// phone, and for delivery the full address and the region where the shop's country
// has regions); it does not add a rule. The server re-validates everything.
export interface MissingField {
  id: string;
  label: string;
}

export function missingRequiredFields(input: {
  orderType: string | null;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  regionId: number | null;
  hasRegions: boolean;
  regionLabel: string;
}): MissingField[] {
  const missing: MissingField[] = [];
  if (!input.customerName.trim()) missing.push({ id: "checkout-name", label: "Name" });
  if (!input.customerPhone.trim()) missing.push({ id: "checkout-phone", label: "Phone" });
  if (input.orderType === "delivery") {
    if (!input.customerAddress.trim()) missing.push({ id: "checkout-address", label: "Full address" });
    if (input.hasRegions && input.regionId === null) missing.push({ id: "checkout-region", label: input.regionLabel });
  }
  return missing;
}

// Moves the shopper to a field: scrolls it into view (clear of a sticky header) and
// focuses it. Safe to call for an id that is not on the page.
export function focusField(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  (el as HTMLElement).focus({ preventScroll: true });
}
