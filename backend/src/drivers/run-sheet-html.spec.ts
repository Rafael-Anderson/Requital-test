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

  const stop = {
    position: 1,
    orderNumber: 9,
    customerName: 'Sara Customer',
    customerPhone: '0500000001',
    address: 'Villa 3',
    deliveryNotes: null,
    timeSlot: null,
    items: [],
    cod: null,
    status: 'pending',
  };
  const sheet = (stops: (typeof stop & { receiverName?: string | null; receiverPhone?: string | null })[]) =>
    renderRunSheetHtml({
      shopName: 'Shop',
      runId: 1,
      runDate: null,
      status: 'dispatched',
      driverName: 'Driver',
      driverPhone: '1',
      notes: null,
      stops,
    });

  it('names the receiver as the contact, with the customer beneath, when one is set', () => {
    const html = sheet([{ ...stop, receiverName: 'Omar Receiver', receiverPhone: '0501112222' }]);
    expect(html).toContain('Receiver: Omar Receiver &middot; 0501112222');
    expect(html).toContain('Customer: Sara Customer &middot; 0500000001');
  });

  it('falls back to the customer alone when there is no receiver', () => {
    const html = sheet([stop]);
    expect(html).toContain('Sara Customer &middot; 0500000001');
    expect(html).not.toContain('Receiver:');
  });

  it('escapes hostile receiver text', () => {
    const html = sheet([{ ...stop, receiverName: '<script>x</script>', receiverPhone: '"><img src=x>' }]);
    expect(html).not.toMatch(/<script|<img/i);
  });
});
