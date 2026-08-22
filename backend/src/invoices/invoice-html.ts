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
  notes: string | null;
  shopName: string;
  shopAddress: string | null;
  shopEmail: string | null;
  currency: string;
  order: {
    id: number;
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
    orderitem: {
      productName: string;
      variantLabel: string | null;
      quantity: number;
      priceAtPurchase: string | number;
      autoDiscountAmount: string | number | null;
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

function money(amount: string | number, currency: string): string {
  return `${currency} ${Number(amount).toFixed(2)}`;
}

export function renderInvoiceHtml(data: InvoiceHtmlData): string {
  const title = data.type === 'PACKING_SLIP' ? 'Packing Slip' : 'Invoice';
  const showMoney = data.type !== 'PACKING_SLIP';
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
      return `<tr><td>${name}</td><td class="num">${item.quantity}</td>${priceCell}</tr>`;
    })
    .join('');

  const totalsRows = showMoney
    ? `
      <tr><td class="label">Subtotal</td><td class="num">${money(data.subtotal, data.currency)}</td></tr>
      ${data.order.discountAmount && Number(data.order.discountAmount) > 0 ? `<tr><td class="label">Discount${data.order.discountCode ? ` (${escapeHtml(data.order.discountCode)})` : ''}</td><td class="num">-${money(data.order.discountAmount, data.currency)}</td></tr>` : ''}
      ${data.order.deliveryFee && Number(data.order.deliveryFee) > 0 ? `<tr><td class="label">Delivery</td><td class="num">${money(data.order.deliveryFee, data.currency)}</td></tr>` : ''}
      <tr><td class="label">Tax</td><td class="num">${money(data.taxAmount, data.currency)}</td></tr>
      <tr class="grand-total"><td class="label">Total</td><td class="num">${money(data.total, data.currency)}</td></tr>
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
  .grand-total td { font-weight: 700; font-size: 16px; border-top: 2px solid #18181b; padding-top: 8px; }
  .notes { margin-top: 24px; font-size: 13px; color: #52525b; white-space: pre-wrap; }
  @media print { body { padding: 0; } }
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
        Order #${data.order.id}<br />
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
      </tr>
    </thead>
    <tbody>
      ${itemRows}
    </tbody>
  </table>

  ${showMoney ? `<table class="totals">${totalsRows}</table>` : ''}

  ${data.notes ? `<p class="notes">${escapeHtml(data.notes)}</p>` : ''}
</body>
</html>`;
}
