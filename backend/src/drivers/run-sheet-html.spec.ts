import { esc, renderRunSheetHtml } from './run-sheet-html';

describe('run sheet', () => {
  it('escapes every customer-typed value, quotes included', () => {
    expect(esc(`<script>"x"&'y'</script>`)).toBe(
      '&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/script&gt;',
    );
    const html = renderRunSheetHtml({
      shopName: '<b>Shop</b>',
      runId: 1,
      runDate: null,
      status: 'dispatched',
      driverName: '"><img src=x onerror=alert(1)>',
      driverPhone: '1',
      notes: '<svg onload=alert(1)>',
      stops: [
        {
          position: 1,
          orderNumber: 7,
          customerName: '<script>alert(1)</script>',
          customerPhone: '050',
          address: "' onmouseover='alert(1)",
          deliveryNotes: '</p><script>x</script>',
          timeSlot: null,
          items: ['<i>Rose</i>'],
          cod: { amount: '10.00', currency: 'AED' },
          status: 'pending',
        },
      ],
    });
    expect(html).not.toMatch(/<script|<img|<svg|<i>|<b>/i);
    expect(html).toContain('CASH TO COLLECT: 10.00 AED');
  });
});
