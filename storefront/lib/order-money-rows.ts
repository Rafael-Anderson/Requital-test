// One convention for "should this money row appear on a customer-facing order
// summary", shared by the two order-detail pages.
//
// They had diverged: the tracking page (app/[shop]/orders/[id]) gated the Tax row
// on `order.taxAmount !== null`, while the account page
// (app/[shop]/account/orders/[id]) gated it on truthiness. On a string field
// those are almost the same test - "0.00" is truthy - so both printed a "Tax 0"
// row on the many shops that charge no tax, and neither formatted the value.
//
// The convention: an amount row appears when there is an amount. A zero is not
// information on a customer's receipt, and a NULL is not either - it means the
// figure was never recorded.
export function hasAmount(value: string | number | null | undefined): boolean {
  if (value === null || value === undefined) return false;
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}
