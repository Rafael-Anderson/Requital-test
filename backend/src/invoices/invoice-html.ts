import { toMajorUnitString } from '../common/currency-minor-units';

// Self-contained, printable HTML — no PDF library is installed in this repo
// (checked package.json for puppeteer/@react-pdf/renderer before writing
// this; see InvoicesController's own comment on the /pdf route). Serving
// this directly as text/html gets the same "open it, print it, save it as
// PDF from the browser" outcome without adding a new dependency.
export interface InvoiceHtmlData {
  invoiceNumber: string;
  type: 'INVOICE' | 'PACKING_SLIP';
  issuedAt: Date;
  subtotal: string | number;
  taxAmount: string | number;
  total: string | number;
  // Tax grouped by rate, for the "of which tax" table a VAT invoice needs (and
  // what I18N-9's proper bilingual VAT invoice builds on). Empty or omitted when
  // the order predates B2's per-line capture, in which case only the single Tax
  // total is shown - an invented breakdown would be worse than none.
  taxBreakdown?: {
    taxRate: number;
    taxableAmount: number;
    taxAmount: number;
    // Set only for the delivery row, which has no product tax class.
    label?: string;
  }[];
  // How the order was priced, frozen on the invoice at issue. `subtotal` is the
  // sum of `priceAtPurchase * quantity`, so when this is true that figure
  // ALREADY contains the tax and the Tax row must be shown as a component of the
  // total ("includes tax of X"), not as another addend. Optional so a caller
  // predating the column still renders the exclusive layout, which is the one
  // that was always arithmetically correct.
  taxInclusive?: boolean;
  notes: string | null;
  shopName: string;
  shopAddress: string | null;
  shopEmail: string | null;
  currency: string;
  order: {
    id: number;
    // The merchant-facing number (migration 20260923130000). `id` is still the
    // identity used for lookups; this is what the printed invoice shows.
    shopOrderNumber: number;
    customerName: string;
    customerPhone: string;
    customerEmail: string | null;
    customerAddress: string;
    emirate: string;
    area: string | null;
    createdAt: Date;
    deliveryFee: string | number | null;
    discountAmount: string | number | null;
    discountCode: string | null;
    paymentMethod: string | null;
    paymentStatus: string;
    orderitem: {
      productName: string;
      variantLabel: string | null;
      quantity: number;
      priceAtPurchase: string | number;
      autoDiscountAmount: string | number | null;
      // The tax this line actually bore, captured at order time (B2). NULL on
      // every order placed before that capture existed, which means UNKNOWN and
      // is why the Tax column and the breakdown below are both omitted rather
      // than printed as zero for those.
      taxRate?: string | number | null;
      taxAmount?: string | number | null;
    }[];
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Code first, matching how this document has always read, but with the
// currency's own decimal width instead of a hardcoded 2 - a KWD invoice line
// must print three decimals or it states a different amount.
function money(amount: string | number, currency: string): string {
  return `${currency} ${toMajorUnitString(Number(amount), currency)}`;
}

export function renderInvoiceHtml(data: InvoiceHtmlData): string {
  const title = data.type === 'PACKING_SLIP' ? 'Packing Slip' : 'Invoice';
  const showMoney = data.type !== 'PACKING_SLIP';
  const isCod = data.order.paymentMethod === 'cash_on_delivery';
  const isPaid = data.order.paymentStatus === 'paid';
  // A per-line Tax column is only meaningful once at least one line carries the
  // capture; on a pre-B2 order every cell would be an em dash, so the column is
  // dropped entirely instead.
  const showTaxColumn =
    showMoney && data.order.orderitem.some((i) => i.taxAmount != null);
  const itemRows = data.order.orderitem
    .map((item) => {
      const baseName = item.variantLabel
        ? `${item.productName} — ${item.variantLabel}`
        : item.productName;
      const hasAutoDiscount =
        item.autoDiscountAmount !== null && Number(item.autoDiscountAmount) > 0;
      const name =
        escapeHtml(baseName) +
        (hasAutoDiscount
          ? `<br><span class="muted">Auto discount: -${money(item.autoDiscountAmount!, data.currency)} per item</span>`
          : '');
      const priceCell = showMoney
        ? `<td class="num">${money(item.priceAtPurchase, data.currency)}</td><td class="num">${money(Number(item.priceAtPurchase) * item.quantity, data.currency)}</td>`
        : '';
      // Only rendered when this order actually carries the capture. A line whose
      // taxAmount is NULL is unknown, not zero, so it prints an em dash rather
      // than a number nobody recorded.
      const taxCell = showTaxColumn
        ? `<td class="num">${
            item.taxAmount == null
              ? '&mdash;'
              : `${money(item.taxAmount, data.currency)}${
                  item.taxRate == null
                    ? ''
                    : ` <span class="muted">(${Number(item.taxRate)}%)</span>`
                }`
          }</td>`
        : '';
      return `<tr><td>${name}</td><td class="num">${item.quantity}</td>${priceCell}${taxCell}</tr>`;
    })
    .join('');

  // Cash-on-delivery amount due, rendered independently of showMoney —
  // a packing slip hides subtotal/per-item pricing from warehouse/rider
  // staff on purpose (see showMoney above), but the rider still needs to
  // know how much cash to collect, so this is a separate element rather
  // than a reason to flip showMoney itself. Non-COD orders render neither
  // block, on either document type.
  const codBlock = !isCod
    ? ''
    : data.type === 'PACKING_SLIP'
      ? isPaid
        ? `<div class="cash-block cash-block-paid">PAID &mdash; no collection required</div>`
        : `<div class="cash-block cash-block-due">CASH TO COLLECT: ${money(data.total, data.currency)}</div>`
      : `<div class="cash-due-box"><span class="cash-due-label">Cash Due</span><span class="cash-due-amount">${money(data.total, data.currency)}</span></div>`;

  // THE ARITHMETIC. This column is something a merchant, a customer and an
  // auditor all read as a sum, so it has to be one.
  //
  // Exclusive pricing: subtotal - discount + delivery + tax = total. Correct as
  // it always was, and rendered unchanged.
  //
  // INCLUSIVE pricing: `subtotal` already contains the tax, so the old layout
  // printed Tax as a further addend and the column overstated the total by
  // exactly the tax. It now reads subtotal - discount + delivery = total, with
  // the tax shown as a labelled component instead of an addend - the ordinary
  // way an inclusive-price VAT invoice states it. No number changes; what
  // changes is that the ones printed now add up.
  const taxRow = data.taxInclusive
    ? `<tr class="tax-included"><td class="label">Includes tax</td><td class="num">${money(data.taxAmount, data.currency)}</td></tr>`
    : `<tr><td class="label">Tax</td><td class="num">${money(data.taxAmount, data.currency)}</td></tr>`;

  // The breakdown by rate. Zero-rated and exempt lines are listed too, with 0
  // tax: on a VAT return "what was zero-rated" is exactly as reportable as what
  // was taxed, which is the whole reason taxclass.type exists.
  const breakdownRows = (data.taxBreakdown ?? [])
    .map(
      (b) =>
        `<tr><td class="label">${
          b.label ?? `Taxable at ${b.taxRate}%`
        }</td><td class="num">${money(
          b.taxableAmount,
          data.currency,
        )}</td><td class="num">${money(b.taxAmount, data.currency)}</td></tr>`,
    )
    .join('');
  const breakdownTable =
    showMoney && breakdownRows
      ? `
    <table class="tax-breakdown">
      <thead>
        <tr><th>Tax summary</th><th class="num">Net</th><th class="num">Tax</th></tr>
      </thead>
      <tbody>${breakdownRows}</tbody>
    </table>`
      : '';

  const totalsRows = showMoney
    ? `
      <tr><td class="label">Subtotal</td><td class="num">${money(data.subtotal, data.currency)}</td></tr>
      ${data.order.discountAmount && Number(data.order.discountAmount) > 0 ? `<tr><td class="label">Discount${data.order.discountCode ? ` (${escapeHtml(data.order.discountCode)})` : ''}</td><td class="num">-${money(data.order.discountAmount, data.currency)}</td></tr>` : ''}
      ${data.order.deliveryFee && Number(data.order.deliveryFee) > 0 ? `<tr><td class="label">Delivery</td><td class="num">${money(data.order.deliveryFee, data.currency)}</td></tr>` : ''}
      ${data.taxInclusive ? '' : taxRow}
      <tr class="grand-total"><td class="label">Total</td><td class="num">${money(data.total, data.currency)}</td></tr>
      ${data.taxInclusive ? taxRow : ''}
    `
    : '';

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${title} ${escapeHtml(data.invoiceNumber)}</title>
<style>
  body { font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; color: #18181b; margin: 0; padding: 32px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #18181b; padding-bottom: 16px; margin-bottom: 24px; }
  .shop-name { font-size: 20px; font-weight: 700; margin: 0 0 4px; }
  .muted { color: #71717a; font-size: 13px; line-height: 1.5; }
  .doc-title { font-size: 24px; font-weight: 700; text-align: right; margin: 0; }
  .doc-number { text-align: right; color: #71717a; font-size: 13px; }
  .addresses { display: flex; justify-content: space-between; gap: 32px; margin-bottom: 24px; }
  .addresses h3 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #71717a; margin: 0 0 6px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
  th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #71717a; border-bottom: 1px solid #e4e4e7; padding: 8px 4px; }
  td { padding: 8px 4px; border-bottom: 1px solid #f4f4f5; font-size: 14px; }
  .num { text-align: right; }
  .totals { width: 280px; margin-left: auto; }
  .totals td { border-bottom: none; padding: 4px; }
  .totals .label { color: #71717a; }
  .tax-breakdown { width: 280px; margin-left: auto; margin-top: 14px; font-size: 12px; }
  .tax-breakdown th { text-align: left; padding: 4px; border-bottom: 1px solid #e4e4e7; }
  .tax-breakdown th.num, .tax-breakdown td.num { text-align: right; }
  .tax-breakdown td { padding: 4px; border-bottom: none; }
  .tax-breakdown .label { color: #71717a; }
  .grand-total td { font-weight: 700; font-size: 16px; border-top: 2px solid #18181b; padding-top: 8px; }
  .notes { margin-top: 24px; font-size: 13px; color: #52525b; white-space: pre-wrap; }
  .cash-due-box { width: 280px; margin-left: auto; margin-top: 12px; padding: 12px 16px; border: 2px solid #18181b; border-radius: 6px; display: flex; justify-content: space-between; align-items: baseline; }
  .cash-due-label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: #71717a; }
  .cash-due-amount { font-size: 20px; font-weight: 700; }
  .cash-block { margin-top: 16px; padding: 20px; border-radius: 8px; text-align: center; font-size: 26px; font-weight: 800; letter-spacing: 0.02em; }
  .cash-block-due { background: #18181b; color: #ffffff; }
  .cash-block-paid { background: #ecfdf5; color: #047857; border: 2px solid #047857; }
  @media print { body { padding: 0; } .cash-block-due { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>
  <div class="header">
    <div>
      <p class="shop-name">${escapeHtml(data.shopName)}</p>
      ${data.shopAddress ? `<p class="muted">${escapeHtml(data.shopAddress)}</p>` : ''}
      ${data.shopEmail ? `<p class="muted">${escapeHtml(data.shopEmail)}</p>` : ''}
    </div>
    <div>
      <p class="doc-title">${title}</p>
      <p class="doc-number">${escapeHtml(data.invoiceNumber)}</p>
      <p class="doc-number">${data.issuedAt.toLocaleDateString()}</p>
    </div>
  </div>

  <div class="addresses">
    <div>
      <h3>Bill To</h3>
      <p class="muted">
        ${escapeHtml(data.order.customerName)}<br />
        ${escapeHtml(data.order.customerPhone)}<br />
        ${data.order.customerEmail ? `${escapeHtml(data.order.customerEmail)}<br />` : ''}
        ${escapeHtml(data.order.customerAddress)}<br />
        ${escapeHtml(data.order.area ? `${data.order.area}, ${data.order.emirate}` : data.order.emirate)}
      </p>
    </div>
    <div>
      <h3>Order</h3>
      <p class="muted">
        Order #${data.order.shopOrderNumber}<br />
        ${data.order.createdAt.toLocaleDateString()}
      </p>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Item</th>
        <th class="num">Qty</th>
        ${showMoney ? '<th class="num">Price</th><th class="num">Total</th>' : ''}
        ${showTaxColumn ? '<th class="num">Tax</th>' : ''}
      </tr>
    </thead>
    <tbody>
      ${itemRows}
    </tbody>
  </table>

  ${showMoney ? `<table class="totals">${totalsRows}</table>` : ''}
  ${breakdownTable}

  ${codBlock}

  ${data.notes ? `<p class="notes">${escapeHtml(data.notes)}</p>` : ''}
</body>
</html>`;
}
