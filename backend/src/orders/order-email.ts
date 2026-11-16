import { minorUnitDecimals } from '../common/currency-minor-units';
import { formatMoney } from '../common/money-format';
import { decimalToMinor, minorToDecimal } from '../drivers/cash';

// The customer-facing order emails: the confirmation (the whole order, a Track
// button) and the Track button block the status emails share. Pure functions of
// already-loaded data: nothing here touches the database, the clock or the
// network, so every rendering rule is unit-tested directly.
//
// MONEY. Every figure is read from what the ORDER captured when it was placed
// (priceAtPurchase, deliveryFee, taxAmount, discountAmount, giftCardAmount,
// storeCreditAmount, total, currency). Nothing is recomputed from today's
// catalogue, tax classes or shop settings. Arithmetic is exact integer minor
// units of the order's own currency (KWD has 3 decimals), and text is produced
// through the shared formatMoney helper, which keeps the ISO code ("AED"): an
// email client cannot be relied on to draw the Dirham glyph.
//
// ESCAPING. Every value a customer or merchant typed (names, address, notes,
// gift message, coupon code, product and variant names) goes through esc() before
// it reaches markup, and esc() also escapes quotes so it is safe in attributes.
//
// LANGUAGE. There is no translation mechanism behind these emails (English only,
// like every other email here), so an Arabic shop gets the same English labels
// laid out right to left, and customer-typed values carry dir="auto" so Arabic
// text renders correctly either way. No unreviewed Arabic copy is shipped.

export interface OrderEmailLine {
  name: string;
  variantLabel: string | null;
  quantity: number;
  // orderitem.priceAtPurchase: the unit price charged, a decimal string.
  unitPrice: string;
  note: string | null;
  imageUrl: string | null;
}

export interface OrderEmailData {
  orderNumber: number;
  createdAtText: string;
  currency: string;
  orderType: string | null;
  paymentMethod: string | null;
  paymentStatus: string;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string;
  // The person who gets the order, when it is not the customer. Both NULL = the
  // customer; nothing extra is shown then.
  receiverName: string | null;
  receiverPhone: string | null;
  address: string | null;
  area: string | null;
  regionName: string | null;
  deliveryDateText: string | null;
  deliveryTimeSlot: string | null;
  deliveryNotes: string | null;
  giftMessage: string | null;
  pickupOutletName: string | null;
  lines: OrderEmailLine[];
  deliveryFee: string | null;
  taxAmount: string | null;
  discountAmount: string | null;
  discountCode: string | null;
  giftCardAmount: string | null;
  storeCreditAmount: string | null;
  total: string;
  shopName: string;
  shopLogoUrl: string | null;
  shopEmail: string | null;
  shopPhone: string | null;
  // null = the order has no tracking token (never invented from the order id).
  trackUrl: string | null;
  rtl: boolean;
}

const ACCENT = '#0d9488';

export function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Customer-typed text in markup: escaped, newlines kept as line breaks, and
// dir="auto" so right-to-left text lays out correctly in a left-to-right email.
function userHtml(value: string): string {
  return `<span dir="auto">${esc(value.trim()).replace(/\r?\n/g, '<br>')}</span>`;
}

// ---- money -----------------------------------------------------------------

// price (decimal string, any precision) x quantity rounded ONCE to the
// currency's minor unit, half up, in exact integer arithmetic. 10.505 x 3 is
// 31.515 -> 31.52, not 3 x round(10.505). Returns null for an unreadable price.
export function lineMinor(
  price: string,
  quantity: number,
  currency: string,
): number | null {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(price.trim());
  if (!m || !Number.isInteger(quantity) || quantity < 1) return null;
  const frac = m[2] ?? '';
  const scaled = BigInt(m[1] + frac) * BigInt(quantity);
  const num = scaled * 10n ** BigInt(minorUnitDecimals(currency));
  const den = 10n ** BigInt(frac.length);
  const minor = (num + den / 2n) / den;
  return minor > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(minor);
}

function minorOf(value: string | null, currency: string): number | null {
  if (value === null || value === undefined || value === '') return null;
  return decimalToMinor(value, currency);
}

function money(minor: number, currency: string): string {
  return formatMoney(minorToDecimal(minor, currency), currency);
}

// ---- the bill --------------------------------------------------------------

export type BillRowKind = 'normal' | 'discount' | 'total' | 'due' | 'note';

export interface BillRow {
  label: string;
  value: string;
  kind: BillRowKind;
}

const PAY_AT_DOOR = new Set([
  'cash_on_delivery',
  'card_on_delivery',
  'cash_on_pickup',
  'card_on_pickup',
]);

export function isPayAtDoor(paymentMethod: string | null): boolean {
  return paymentMethod !== null && PAY_AT_DOOR.has(paymentMethod);
}

// The mode the stored total was built in is not recorded on the order (the shop
// setting can have been flipped since), so it is read off the order's own
// captured figures: an inclusive total is goods less discount plus delivery, an
// exclusive one adds the tax on top. Same rule as the returns refund.
function isTaxInclusive(p: {
  subtotal: number;
  discount: number;
  delivery: number;
  tax: number;
  total: number;
}): boolean {
  const inclusiveTotal = p.subtotal - Math.min(p.discount, p.subtotal) + p.delivery;
  return (
    Math.abs(p.total - inclusiveTotal) <
    Math.abs(p.total - (inclusiveTotal + p.tax))
  );
}

// Subtotal, discount, delivery, tax, total, then what was paid by gift card and
// store credit, then (for pay at the door, or when a tender reduced it) what is
// still due. Every row appears only when the order has something to say about it:
// a NULL figure is UNKNOWN and is left out, never shown as zero.
export function buildBillRows(d: OrderEmailData): BillRow[] {
  const cur = d.currency;
  const rows: BillRow[] = [];

  let subtotal = 0;
  for (const l of d.lines) {
    subtotal += lineMinor(l.unitPrice, l.quantity, cur) ?? 0;
  }
  const discount = Math.max(minorOf(d.discountAmount, cur) ?? 0, 0);
  const deliveryKnown = minorOf(d.deliveryFee, cur);
  const delivery = Math.max(deliveryKnown ?? 0, 0);
  const tax = Math.max(minorOf(d.taxAmount, cur) ?? 0, 0);
  const total = minorOf(d.total, cur) ?? 0;
  const gift = Math.max(minorOf(d.giftCardAmount, cur) ?? 0, 0);
  const credit = Math.max(minorOf(d.storeCreditAmount, cur) ?? 0, 0);

  rows.push({ label: 'Subtotal', value: money(subtotal, cur), kind: 'normal' });
  if (discount > 0) {
    rows.push({
      label: d.discountCode ? `Discount (${d.discountCode})` : 'Discount',
      value: `-${money(discount, cur)}`,
      kind: 'discount',
    });
  }
  if (d.orderType === 'delivery' && deliveryKnown !== null) {
    rows.push({
      label: 'Delivery fee',
      value: delivery > 0 ? money(delivery, cur) : 'Free',
      kind: 'normal',
    });
  }
  if (tax > 0) {
    const inclusive = isTaxInclusive({ subtotal, discount, delivery, tax, total });
    rows.push({
      label: inclusive ? 'VAT (included in the prices)' : 'VAT',
      value: money(tax, cur),
      kind: 'normal',
    });
  }
  rows.push({ label: 'Total', value: money(total, cur), kind: 'total' });
  if (gift > 0) {
    rows.push({ label: 'Paid by gift card', value: `-${money(gift, cur)}`, kind: 'discount' });
  }
  if (credit > 0) {
    rows.push({ label: 'Paid by store credit', value: `-${money(credit, cur)}`, kind: 'discount' });
  }
  const due = Math.max(total - gift - credit, 0);
  if (isPayAtDoor(d.paymentMethod)) {
    rows.push({
      label:
        d.orderType === 'pickup'
          ? 'Amount due on pickup'
          : 'Amount due on delivery',
      value: money(due, cur),
      kind: 'due',
    });
  } else if (gift > 0 || credit > 0) {
    rows.push({ label: 'Amount to pay', value: money(due, cur), kind: 'due' });
  }
  return rows;
}

// ---- payment wording -------------------------------------------------------

const METHOD_LABELS: Record<string, string> = {
  card_online: 'Card (online)',
  cash_on_delivery: 'Cash on delivery',
  card_on_delivery: 'Card on delivery',
  cash_on_pickup: 'Cash on pickup',
  card_on_pickup: 'Card on pickup',
  paypal: 'PayPal',
  tabby: 'Tabby',
  tamara: 'Tamara',
};

export function paymentMethodLabel(method: string | null): string | null {
  if (!method) return null;
  return METHOD_LABELS[method] ?? method.replace(/_/g, ' ');
}

export function paymentStatusLabel(d: {
  paymentStatus: string;
  paymentMethod: string | null;
  orderType: string | null;
}): string {
  switch (d.paymentStatus) {
    case 'paid':
      return 'Paid';
    case 'refunded':
      return 'Refunded';
    case 'partially_refunded':
      return 'Partially refunded';
    case 'unpaid':
      return isPayAtDoor(d.paymentMethod)
        ? d.orderType === 'pickup'
          ? 'To be paid on pickup'
          : 'To be paid on delivery'
        : 'Awaiting payment';
    default:
      return d.paymentStatus.replace(/_/g, ' ');
  }
}

// ---- the Track your order block --------------------------------------------

// A bulletproof button (a table cell, so it survives clients that drop CSS on a
// link) with the plain URL beneath it. Shared by the confirmation and the status
// emails so the block cannot drift between them.
export function renderTrackBlockHtml(url: string): string {
  const href = esc(url);
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 12px;"><tr><td style="border-radius:6px;background-color:${ACCENT};"><a href="${href}" style="display:inline-block;padding:14px 32px;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:6px;">Track your order</a></td></tr></table>
<p style="margin:0 0 4px;font-size:13px;color:#666666;">Or copy this link into your browser:</p>
<p style="margin:0;font-size:12px;color:#666666;font-family:monospace;word-break:break-all;"><a href="${href}" style="color:#666666;text-decoration:underline;">${esc(url)}</a></p>`;
}

export function renderTrackBlockText(url: string): string {
  return `Track your order: ${url}`;
}

// ---- Customer and Receiver --------------------------------------------------

export interface PeopleInput {
  customerName: string;
  customerEmail: string | null;
  receiverName: string | null;
  receiverPhone: string | null;
}

// True only when BOTH are present (the API stores them together).
export function hasReceiver(p: {
  receiverName: string | null;
  receiverPhone: string | null;
}): boolean {
  return Boolean((p.receiverName ?? '').trim() && (p.receiverPhone ?? '').trim());
}

// A "Customer" (name, email) and a "Receiver" (name, phone) block, shared by the
// confirmation and the out-for-delivery emails so they cannot drift. Empty string
// when no receiver is set: an order for the customer themselves is unchanged.
// Every value is customer-typed, so every value is escaped.
export function renderPeopleBlockHtml(p: PeopleInput, align: string): string {
  if (!hasReceiver(p)) return '';
  const customer: string[] = [detailRow('Name', userHtml(p.customerName), align)];
  if (p.customerEmail) customer.push(detailRow('Email', userHtml(p.customerEmail), align));
  const receiver: string[] = [
    detailRow('Name', userHtml(p.receiverName as string), align),
    detailRow('Phone', userHtml(p.receiverPhone as string), align),
  ];
  return `${sectionTitle('Customer', align)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${customer.join('\n')}</table>
${sectionTitle('Receiver', align)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${receiver.join('\n')}</table>`;
}

export function renderPeopleBlockText(p: PeopleInput): string[] {
  if (!hasReceiver(p)) return [];
  const out = ['CUSTOMER', `Name: ${oneLine(p.customerName)}`];
  if (p.customerEmail) out.push(`Email: ${oneLine(p.customerEmail)}`);
  out.push('', 'RECEIVER', `Name: ${oneLine(p.receiverName as string)}`, `Phone: ${oneLine(p.receiverPhone as string)}`);
  return out;
}

// ---- the confirmation email ------------------------------------------------

function detailRow(label: string, valueHtml: string, align: string): string {
  return `<tr><td style="padding:4px 0;font-size:13px;color:#666666;width:38%;vertical-align:top;text-align:${align};">${esc(label)}</td><td style="padding:4px 0;font-size:14px;color:#111111;vertical-align:top;text-align:${align};">${valueHtml}</td></tr>`;
}

function sectionTitle(title: string, align: string): string {
  return `<p style="margin:24px 0 8px;font-size:13px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;color:#111111;text-align:${align};">${esc(title)}</p>`;
}

function httpsOnly(url: string | null): string | null {
  return url && /^https:\/\//i.test(url) ? url : null;
}

function lineHtml(l: OrderEmailLine, currency: string, start: string, end: string): string {
  const total = lineMinor(l.unitPrice, l.quantity, currency);
  const img = httpsOnly(l.imageUrl);
  const thumb = img
    ? `<img src="${esc(img)}" width="56" height="56" alt="${esc(l.name)}" style="display:block;width:56px;height:56px;object-fit:cover;border-radius:4px;border:0;">`
    : '';
  const variant = l.variantLabel
    ? `<div style="font-size:13px;color:#666666;">${userHtml(l.variantLabel)}</div>`
    : '';
  const note = l.note
    ? `<div style="font-size:12px;color:#666666;font-style:italic;">${userHtml(l.note)}</div>`
    : '';
  return `<tr>
<td width="64" style="padding:10px 0;border-bottom:1px solid #eeeeee;vertical-align:top;">${thumb}</td>
<td style="padding:10px 8px;border-bottom:1px solid #eeeeee;vertical-align:top;text-align:${start};font-size:14px;color:#111111;"><div style="font-weight:600;">${userHtml(l.name)}</div>${variant}<div style="font-size:13px;color:#666666;">${l.quantity} &times; ${esc(formatMoney(l.unitPrice, currency))}</div>${note}</td>
<td style="padding:10px 0;border-bottom:1px solid #eeeeee;vertical-align:top;text-align:${end};font-size:14px;font-weight:600;color:#111111;white-space:nowrap;">${total === null ? '' : esc(money(total, currency))}</td>
</tr>`;
}

function deliveryAddressText(d: OrderEmailData): string | null {
  const parts = [d.address, d.area, d.regionName]
    .map((p) => (p ?? '').trim())
    .filter((p) => p.length > 0);
  // The street address often already names the area or region: say each once.
  const seen = new Set<string>();
  const unique = parts.filter((p) => {
    const key = p.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return unique.length > 0 ? unique.join(', ') : null;
}

export function renderOrderConfirmationHtml(d: OrderEmailData): string {
  const start = d.rtl ? 'right' : 'left';
  const end = d.rtl ? 'left' : 'right';
  const dir = d.rtl ? 'rtl' : 'ltr';
  const isPickup = d.orderType === 'pickup';

  const header = d.shopLogoUrl && httpsOnly(d.shopLogoUrl)
    ? `<img src="${esc(d.shopLogoUrl)}" alt="${esc(d.shopName)}" height="44" style="display:inline-block;max-height:44px;max-width:240px;border:0;">`
    : `<span style="color:#ffffff;font-size:22px;font-weight:600;">${esc(d.shopName)}</span>`;
  const headerBg = d.shopLogoUrl && httpsOnly(d.shopLogoUrl) ? '#ffffff' : ACCENT;

  const rows = buildBillRows(d)
    .map((r) => {
      const heavy = r.kind === 'total' || r.kind === 'due';
      const color = r.kind === 'discount' ? '#0d7a4a' : '#111111';
      const top = r.kind === 'total' ? 'border-top:2px solid #111111;' : '';
      return `<tr><td style="padding:6px 0;${top}font-size:${heavy ? 15 : 14}px;font-weight:${heavy ? 700 : 400};color:${color};text-align:${start};">${esc(r.label)}</td><td style="padding:6px 0;${top}font-size:${heavy ? 15 : 14}px;font-weight:${heavy ? 700 : 400};color:${color};text-align:${end};white-space:nowrap;">${esc(r.value)}</td></tr>`;
    })
    .join('\n');

  const items = d.lines.map((l) => lineHtml(l, d.currency, start, end)).join('\n');

  const method = paymentMethodLabel(d.paymentMethod);
  const payment: string[] = [];
  if (method) payment.push(detailRow('Payment method', esc(method), start));
  payment.push(detailRow('Payment status', esc(paymentStatusLabel(d)), start));

  // The Receiver section (name, phone) only when one is set. The Customer section
  // above keeps its own name, email and phone exactly as before.
  const receiverHtml = hasReceiver(d)
    ? `${sectionTitle('Receiver', start)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${detailRow('Name', userHtml(d.receiverName as string), start)}${detailRow('Phone', userHtml(d.receiverPhone as string), start)}</table>`
    : '';
  const customer: string[] = [detailRow('Name', userHtml(d.customerName), start)];
  if (d.customerEmail) customer.push(detailRow('Email', userHtml(d.customerEmail), start));
  if (d.customerPhone) customer.push(detailRow('Phone', userHtml(d.customerPhone), start));

  const fulfilment: string[] = [];
  if (isPickup) {
    fulfilment.push(detailRow('Method', 'Pickup', start));
    if (d.pickupOutletName) fulfilment.push(detailRow('Pickup location', userHtml(d.pickupOutletName), start));
  } else {
    fulfilment.push(detailRow('Method', 'Delivery', start));
    const address = deliveryAddressText(d);
    if (address) fulfilment.push(detailRow('Delivery address', userHtml(address), start));
  }
  if (d.deliveryDateText) {
    fulfilment.push(detailRow(isPickup ? 'Pickup date' : 'Delivery date', esc(d.deliveryDateText), start));
  }
  if (d.deliveryTimeSlot) {
    fulfilment.push(detailRow(isPickup ? 'Pickup time' : 'Delivery time', userHtml(d.deliveryTimeSlot), start));
  }
  if (d.deliveryNotes && d.deliveryNotes.trim()) {
    fulfilment.push(detailRow('Delivery notes', userHtml(d.deliveryNotes), start));
  }
  if (d.giftMessage && d.giftMessage.trim()) {
    fulfilment.push(detailRow('Gift message', userHtml(d.giftMessage), start));
  }

  const contactBits: string[] = [];
  if (d.shopEmail) contactBits.push(esc(d.shopEmail));
  if (d.shopPhone) contactBits.push(esc(d.shopPhone));
  const contact = contactBits.length
    ? `<p style="margin:24px 0 0;font-size:13px;color:#666666;text-align:${start};">Questions about your order? Contact ${esc(d.shopName)}: ${contactBits.join(' &middot; ')}</p>`
    : '';

  const track = d.trackUrl
    ? `<div style="margin:20px 0 4px;text-align:${start};">${renderTrackBlockHtml(d.trackUrl)}</div>`
    : '';

  return `<span style="display:none;max-height:0;overflow:hidden;opacity:0;">Order #${d.orderNumber} from ${esc(d.shopName)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="${dir}" style="background-color:#f4f4f4;padding:24px 8px;direction:${dir};"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<tr><td style="background-color:${headerBg};height:60px;text-align:center;vertical-align:middle;padding:8px 16px;border-bottom:3px solid ${ACCENT};">${header}</td></tr>
<tr><td style="padding:28px 24px 8px;text-align:${start};">
<p style="margin:0 0 12px;font-size:15px;line-height:1.5;color:#111111;">Hi ${userHtml(d.customerName)},</p>
<p style="margin:0;font-size:15px;line-height:1.5;color:#111111;">Thanks for your order. We've received it.</p>
<p style="margin:12px 0 0;font-size:14px;color:#444444;">Order <strong>#${d.orderNumber}</strong> &middot; ${esc(d.createdAtText)}</p>
${track}
</td></tr>
<tr><td style="padding:0 24px;">
${sectionTitle('Your items', start)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${items}
</table>
${sectionTitle('Order summary', start)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${rows}
</table>
${sectionTitle('Payment', start)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${payment.join('\n')}</table>
${sectionTitle(isPickup ? 'Pickup details' : 'Delivery details', start)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${fulfilment.join('\n')}</table>
${sectionTitle('Customer', start)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${customer.join('\n')}</table>
${receiverHtml}
${contact}
</td></tr>
<tr><td style="padding:24px 24px 0;"><hr style="border:none;border-top:1px solid #e5e5e5;margin:0;"></td></tr>
<tr><td style="padding:20px 24px 32px;text-align:center;">
<p style="margin:0 0 8px;font-size:12px;color:#999999;">This email was sent by ${esc(d.shopName)} via Requital.</p>
<p style="margin:0;font-size:12px;color:#999999;">&copy; 2026 Requital</p>
</td></tr>
</table>
</td></tr></table>`;
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function renderOrderConfirmationText(d: OrderEmailData): string {
  const out: string[] = [];
  out.push(`Hi ${oneLine(d.customerName)},`);
  out.push('');
  out.push(`Thanks for your order. We've received it.`);
  out.push(`Order #${d.orderNumber} - ${d.createdAtText} - ${d.shopName}`);
  if (d.trackUrl) {
    out.push('');
    out.push(renderTrackBlockText(d.trackUrl));
  }
  out.push('');
  out.push('YOUR ITEMS');
  for (const l of d.lines) {
    const total = lineMinor(l.unitPrice, l.quantity, d.currency);
    const variant = l.variantLabel ? ` (${oneLine(l.variantLabel)})` : '';
    out.push(
      `- ${oneLine(l.name)}${variant}: ${l.quantity} x ${formatMoney(l.unitPrice, d.currency)}${total === null ? '' : ` = ${money(total, d.currency)}`}`,
    );
    if (l.note) out.push(`  Note: ${oneLine(l.note)}`);
  }
  out.push('');
  out.push('ORDER SUMMARY');
  for (const r of buildBillRows(d)) out.push(`${r.label}: ${r.value}`);
  out.push('');
  out.push('PAYMENT');
  const method = paymentMethodLabel(d.paymentMethod);
  if (method) out.push(`Payment method: ${method}`);
  out.push(`Payment status: ${paymentStatusLabel(d)}`);
  out.push('');
  const isPickup = d.orderType === 'pickup';
  out.push(isPickup ? 'PICKUP DETAILS' : 'DELIVERY DETAILS');
  if (isPickup) {
    if (d.pickupOutletName) out.push(`Pickup location: ${oneLine(d.pickupOutletName)}`);
  } else {
    const address = deliveryAddressText(d);
    if (address) out.push(`Delivery address: ${oneLine(address)}`);
  }
  if (d.deliveryDateText) out.push(`${isPickup ? 'Pickup' : 'Delivery'} date: ${d.deliveryDateText}`);
  if (d.deliveryTimeSlot) out.push(`${isPickup ? 'Pickup' : 'Delivery'} time: ${oneLine(d.deliveryTimeSlot)}`);
  if (d.deliveryNotes && d.deliveryNotes.trim()) out.push(`Delivery notes: ${oneLine(d.deliveryNotes)}`);
  if (d.giftMessage && d.giftMessage.trim()) out.push(`Gift message: ${oneLine(d.giftMessage)}`);
  out.push('');
  out.push('CUSTOMER');
  out.push(`Name: ${oneLine(d.customerName)}`);
  if (d.customerEmail) out.push(`Email: ${oneLine(d.customerEmail)}`);
  if (d.customerPhone) out.push(`Phone: ${oneLine(d.customerPhone)}`);
  if (hasReceiver(d)) {
    out.push('');
    out.push('RECEIVER');
    out.push(`Name: ${oneLine(d.receiverName as string)}`);
    out.push(`Phone: ${oneLine(d.receiverPhone as string)}`);
  }
  const contactBits = [d.shopEmail, d.shopPhone].filter((v): v is string => !!v);
  if (contactBits.length) {
    out.push('');
    out.push(`Questions about your order? Contact ${d.shopName}: ${contactBits.join(' | ')}`);
  }
  return out.join('\n');
}
