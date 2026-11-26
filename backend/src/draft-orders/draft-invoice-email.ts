import { escapeHtml } from '../common/email';
import { formatMoney } from '../common/money-format';
import type { DraftSnapshot } from './draft-orders.service';

// The invoice a merchant emails for a custom order: the frozen lines and bill
// split, the delivery or pickup details, the shop's contact and a Pay button.
// Same outer layout as the other customer emails (order-notifications). Every
// value is escaped. No internal note, no staff name.
export function buildDraftInvoiceEmail(input: {
  shopName: string;
  shopEmail: string | null;
  shopPhone: string | null;
  payUrl: string;
  snapshot: DraftSnapshot;
}): { subject: string; text: string; html: string } {
  const { bill, fulfilment: f } = input.snapshot;
  const money = (v: string | null) =>
    v === null ? '' : formatMoney(v, bill.currency);
  const rows: [string, string][] = [['Subtotal', money(bill.subtotal)]];
  if (Number(bill.discount.amount) > 0) {
    rows.push([
      bill.discount.code ? `Discount (${bill.discount.code})` : 'Discount',
      `-${money(bill.discount.amount)}`,
    ]);
  }
  rows.push([
    f.orderType === 'pickup' ? 'Pickup' : 'Delivery',
    Number(bill.deliveryFee ?? 0) > 0 ? money(bill.deliveryFee) : 'Free',
  ]);
  if (bill.taxAmount !== null && Number(bill.taxAmount) > 0) {
    rows.push([
      bill.taxInclusive ? 'Includes tax' : 'Tax',
      money(bill.taxAmount),
    ]);
  }
  const subject = `Your order from ${input.shopName}: ${money(bill.total)}`;
  const fulfilmentLines =
    f.orderType === 'pickup'
      ? [`Pickup at ${f.outletName}`]
      : [
          `Delivery to ${[f.customerAddress, f.area, f.regionName].filter(Boolean).join(', ')}`,
        ];
  if (f.deliveryDate) {
    fulfilmentLines.push(
      `${f.orderType === 'pickup' ? 'Pickup' : 'Delivery'} date: ${f.deliveryDate}${f.deliveryTimeSlot ? `, ${f.deliveryTimeSlot}` : ''}`,
    );
  }
  if (f.receiverName)
    fulfilmentLines.push(
      `Receiver: ${f.receiverName}, ${f.receiverPhone ?? ''}`,
    );
  if (f.receiverMessage)
    fulfilmentLines.push(`Gift message: ${f.receiverMessage}`);
  if (f.customerNote) fulfilmentLines.push(`Note: ${f.customerNote}`);
  const contact = [input.shopPhone, input.shopEmail]
    .filter(Boolean)
    .join(' · ');

  const text = [
    `Hi ${f.customerName},`,
    '',
    `${input.shopName} prepared this order for you.`,
    '',
    ...bill.lines.map(
      (l) =>
        `${l.quantity} x ${l.name}${l.variantLabel ? ` (${l.variantLabel})` : ''}: ${money(l.lineTotal)}`,
    ),
    '',
    ...rows.map(([k, v]) => `${k}: ${v}`),
    `Total: ${money(bill.total)}`,
    '',
    ...fulfilmentLines,
    '',
    `Pay here: ${input.payUrl}`,
    ...(contact
      ? ['', `Questions? Contact ${input.shopName}: ${contact}`]
      : []),
  ].join('\n');

  const cell = 'padding:6px 0;font-size:14px;color:#111111;';
  const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f4;padding:32px 16px;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<tr><td style="background-color:#0d9488;height:60px;text-align:center;vertical-align:middle;"><span style="color:#ffffff;font-size:22px;font-weight:600;">${escapeHtml(input.shopName)}</span></td></tr>
<tr><td style="padding:40px;">
<p style="margin:0 0 16px;font-size:15px;line-height:1.5;color:#111111;">Hi ${escapeHtml(f.customerName)},</p>
<p style="margin:0 0 20px;font-size:15px;line-height:1.5;color:#111111;">${escapeHtml(input.shopName)} prepared this order for you.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${bill.lines
  .map(
    (l) =>
      `<tr><td style="${cell}">${l.quantity} x ${escapeHtml(l.name)}${l.variantLabel ? ` (${escapeHtml(l.variantLabel)})` : ''}</td><td style="${cell}text-align:right;">${escapeHtml(money(l.lineTotal))}</td></tr>`,
  )
  .join('\n')}
<tr><td colspan="2"><hr style="border:none;border-top:1px solid #e5e5e5;margin:8px 0;"></td></tr>
${rows
  .map(
    ([k, v]) =>
      `<tr><td style="${cell}color:#555555;">${escapeHtml(k)}</td><td style="${cell}text-align:right;">${escapeHtml(v)}</td></tr>`,
  )
  .join('\n')}
<tr><td style="${cell}font-weight:700;">Total</td><td style="${cell}text-align:right;font-weight:700;">${escapeHtml(money(bill.total))}</td></tr>
</table>
<p style="margin:20px 0 0;font-size:14px;line-height:1.6;color:#333333;">${fulfilmentLines.map((l) => escapeHtml(l)).join('<br>')}</p>
<div style="margin:28px 0 0;text-align:center;"><a href="${escapeHtml(input.payUrl)}" style="display:inline-block;background-color:#0d9488;color:#ffffff;text-decoration:none;font-weight:600;font-size:16px;padding:12px 28px;border-radius:8px;">Pay ${escapeHtml(money(bill.total))}</a></div>
${contact ? `<p style="margin:24px 0 0;font-size:13px;color:#666666;">Questions? Contact ${escapeHtml(input.shopName)}: ${escapeHtml(contact)}</p>` : ''}
</td></tr>
</table>
</td></tr></table>`;
  return { subject, text, html };
}
