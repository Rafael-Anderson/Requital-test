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
  // "Receiver is someone else". Unchecked = the customer receives it and nothing
  // about a receiver is required or sent; checked = both a name and a phone.
  receiverIsOther?: boolean;
  receiverName?: string;
  receiverPhone?: string;
}): MissingField[] {
  const missing: MissingField[] = [];
  if (!input.customerName.trim()) missing.push({ id: "checkout-name", label: "Name" });
  if (!input.customerPhone.trim()) missing.push({ id: "checkout-phone", label: "Phone" });
  if (input.orderType === "delivery") {
    if (!input.customerAddress.trim()) missing.push({ id: "checkout-address", label: "Full address" });
    if (input.hasRegions && input.regionId === null) missing.push({ id: "checkout-region", label: input.regionLabel });
  }
  if (input.receiverIsOther) {
    if (!(input.receiverName ?? "").trim()) missing.push({ id: "checkout-receiver-name", label: "Receiver name" });
    if (!RECEIVER_PHONE_PATTERN.test((input.receiverPhone ?? "").trim())) {
      missing.push({ id: "checkout-receiver-phone", label: "Receiver phone" });
    }
  }
  return missing;
}

// The same phone rule the server applies to customerPhone and receiverPhone
// (CreatePublicOrderDto): digits, spaces, hyphens, an optional leading "+", 6 to 20
// characters. Checked here for the receiver so a short number is caught before
// the order is sent rather than answered with a 400.
export const RECEIVER_PHONE_PATTERN = /^\+?[0-9][0-9\s-]{5,19}$/;

// Moves the shopper to a field: scrolls it into view (clear of a sticky header) and
// focuses it. Safe to call for an id that is not on the page.
export function focusField(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  (el as HTMLElement).focus({ preventScroll: true });
}
