// Printable run sheet for a driver: stops in order with address, phone, notes,
// the cash to collect and a signature line. Self-contained HTML (no PDF library
// in this repo; the browser's Print > Save as PDF is the "download"), like the
// invoice and packing slip. EVERY dynamic value goes through esc(): customer
// names, addresses and notes are customer-typed text.

export interface RunSheetStop {
  position: number;
  orderNumber: number;
  customerName: string;
  customerPhone: string;
  address: string;
  deliveryNotes: string | null;
  timeSlot: string | null;
  items: string[];
  // Cash to collect (COD, not yet collected); null otherwise.
  cod: { amount: string; currency: string } | null;
  status: string;
}

export interface RunSheetData {
  shopName: string;
  runId: number;
  runDate: string | null;
  status: string;
  driverName: string;
  driverPhone: string;
  notes: string | null;
  stops: RunSheetStop[];
}

// Escapes text for both element content and quoted attribute values.
export function esc(value: string | number | null | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderRunSheetHtml(d: RunSheetData): string {
  const stops = d.stops
    .map(
      (s) => `<section class="stop">
  <div class="head"><span class="n">${esc(s.position)}</span><strong>Order #${esc(s.orderNumber)}</strong>${s.status !== 'pending' ? `<span class="tag">${esc(s.status)}</span>` : ''}${s.timeSlot ? `<span class="slot">${esc(s.timeSlot)}</span>` : ''}</div>
  <p class="who">${esc(s.customerName)} &middot; ${esc(s.customerPhone)}</p>
  <p class="addr">${esc(s.address)}</p>
  ${s.deliveryNotes ? `<p class="notes">Notes: ${esc(s.deliveryNotes)}</p>` : ''}
  ${s.items.length ? `<p class="items">${s.items.map(esc).join('; ')}</p>` : ''}
  ${s.cod ? `<p class="cash">CASH TO COLLECT: ${esc(s.cod.amount)} ${esc(s.cod.currency)}</p>` : ''}
  <div class="sign"><span>Received by (name / signature)</span></div>
</section>`,
    )
    .join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Run sheet #${esc(d.runId)}</title>
<style>
body{font:14px/1.4 -apple-system,Segoe UI,Arial,sans-serif;color:#111;margin:24px;max-width:780px}
h1{font-size:20px;margin:0 0 4px}.meta{color:#444;margin:0 0 16px}
.stop{border:1px solid #999;border-radius:6px;padding:10px 12px;margin:0 0 12px;break-inside:avoid}
.head{display:flex;gap:10px;align-items:center}.n{display:inline-block;min-width:24px;height:24px;line-height:24px;text-align:center;background:#111;color:#fff;border-radius:12px}
.tag,.slot{font-size:12px;border:1px solid #666;border-radius:4px;padding:0 6px}.who{font-weight:600;margin:6px 0 0}.addr{margin:2px 0}.notes,.items{margin:2px 0;color:#333}
.cash{margin:6px 0;font-weight:700;border:2px solid #111;padding:4px 8px;display:inline-block}
.sign{margin-top:14px;border-top:1px solid #333;padding-top:2px;font-size:11px;color:#555}
@media print{body{margin:8mm}}
</style></head><body>
<h1>${esc(d.shopName)}: delivery run #${esc(d.runId)}</h1>
<p class="meta">Driver: ${esc(d.driverName)} (${esc(d.driverPhone)})${d.runDate ? ` &middot; Date: ${esc(d.runDate)}` : ''} &middot; Status: ${esc(d.status)}${d.notes ? `<br>Notes: ${esc(d.notes)}` : ''}</p>
${stops || '<p>No stops.</p>'}
</body></html>`;
}
