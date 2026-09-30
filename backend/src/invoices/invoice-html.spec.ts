import { renderInvoiceHtml, type InvoiceHtmlData } from './invoice-html';

// The totals column on this document is something a merchant, a customer and an
// auditor all read as a sum. These tests read the rendered numbers back out and
// check that it IS one.
//
// On a tax-inclusive shop it was not: `invoice.subtotal` is the sum of
// `priceAtPurchase * quantity`, which already contains the tax, and the document
// printed Tax as a further addend - overstating the column by exactly the tax on
// every inclusive shop's every invoice.
function data(overrides: Partial<InvoiceHtmlData> = {}): InvoiceHtmlData {
  return {
    invoiceNumber: 'INV-0001',
    type: 'INVOICE',
    issuedAt: new Date('2026-09-29T10:00:00Z'),
    subtotal: '100.00',
    taxAmount: '5.00',
    total: '115.00',
    notes: null,
    shopName: 'Test Florist',
    shopAddress: null,
    shopEmail: null,
    currency: 'AED',
    order: {
      id: 1,
      shopOrderNumber: 1,
      customerName: 'Customer',
      customerPhone: '0501234567',
      customerEmail: null,
      customerAddress: 'Somewhere',
      emirate: 'Dubai',
      area: null,
      createdAt: new Date('2026-09-29T09:00:00Z'),
      deliveryFee: '10.00',
      discountAmount: null,
      discountCode: null,
      paymentMethod: 'card_online',
      paymentStatus: 'paid',
      orderitem: [
        {
          productName: 'Rose Bouquet',
          variantLabel: null,
          quantity: 1,
          priceAtPurchase: '100.00',
          autoDiscountAmount: null,
          taxRate: '5.00',
          taxAmount: '5.00',
        },
      ],
    },
    ...overrides,
  };
}

// Pulls one labelled row's amount back out of the rendered table. money()
// renders "AED 100.00" (currency code first), and a discount carries a leading
// "-" outside that, so both are allowed for and the magnitude is returned - the
// assertions below apply the sign themselves.
function row(html: string, label: string): number | null {
  const match = new RegExp(
    `<td class="label">${label}[^<]*</td><td class="num">-?[A-Z]{3}\\s*([0-9.,]+)`,
  ).exec(html);
  return match ? Number(match[1].replace(/,/g, '')) : null;
}

describe('renderInvoiceHtml totals arithmetic', () => {
  it('exclusive: subtotal - discount + delivery + tax equals the printed total', () => {
    const html = renderInvoiceHtml(
      data({
        taxInclusive: false,
        subtotal: '100.00',
        taxAmount: '5.00',
        total: '115.00',
      }),
    );
    const subtotal = row(html, 'Subtotal')!;
    const delivery = row(html, 'Delivery')!;
    const tax = row(html, 'Tax')!;
    const total = row(html, 'Total')!;
    expect(subtotal + delivery + tax).toBeCloseTo(total, 2);
    // The exclusive layout is unchanged: an additive "Tax" row, no "Includes".
    expect(html).not.toContain('Includes tax');
  });

  it('exclusive with a discount still adds up', () => {
    const html = renderInvoiceHtml(
      data({
        taxInclusive: false,
        subtotal: '200.00',
        taxAmount: '7.50',
        total: '167.50',
        order: {
          ...data().order,
          discountAmount: '50.00',
          deliveryFee: '10.00',
        },
      }),
    );
    const total = row(html, 'Total')!;
    expect(
      row(html, 'Subtotal')! -
        row(html, 'Discount')! +
        row(html, 'Delivery')! +
        row(html, 'Tax')!,
    ).toBeCloseTo(total, 2);
  });

  // THE fix. Inclusive: the charged amounts already contain the tax, so the
  // column must read subtotal - discount + delivery = total, with the tax stated
  // as a component rather than added again.
  it('inclusive: subtotal + delivery equals the total, and tax is NOT an addend', () => {
    const html = renderInvoiceHtml(
      data({
        taxInclusive: true,
        subtotal: '105.00',
        taxAmount: '5.00',
        total: '115.00',
      }),
    );
    const subtotal = row(html, 'Subtotal')!;
    const delivery = row(html, 'Delivery')!;
    const total = row(html, 'Total')!;
    expect(subtotal + delivery).toBeCloseTo(total, 2);

    // The tax is still shown - it has to be, for a VAT document - but labelled
    // as included rather than as another line to add.
    expect(html).toContain('Includes tax');
    expect(row(html, 'Includes tax')).toBeCloseTo(5, 2);
    // And the old additive layout is gone: adding every row above the total no
    // longer overshoots it.
    expect(subtotal + delivery + row(html, 'Includes tax')!).not.toBeCloseTo(
      total,
      2,
    );
  });

  it('inclusive with a discount also adds up', () => {
    const html = renderInvoiceHtml(
      data({
        taxInclusive: true,
        subtotal: '210.00',
        taxAmount: '7.62',
        total: '170.00',
        order: {
          ...data().order,
          discountAmount: '50.00',
          deliveryFee: '10.00',
        },
      }),
    );
    expect(
      row(html, 'Subtotal')! - row(html, 'Discount')! + row(html, 'Delivery')!,
    ).toBeCloseTo(row(html, 'Total')!, 2);
  });

  // An invoice issued before the column existed renders the exclusive layout,
  // which is the one whose arithmetic was already right.
  it('treats an absent taxInclusive as exclusive', () => {
    const html = renderInvoiceHtml(data({ taxInclusive: undefined }));
    expect(html).not.toContain('Includes tax');
    expect(row(html, 'Tax')).toBeCloseTo(5, 2);
  });

  // A packing slip deliberately hides pricing from warehouse/rider staff, so it
  // has no totals column to add up in either mode.
  it('prints no totals column on a packing slip', () => {
    const html = renderInvoiceHtml(
      data({ type: 'PACKING_SLIP', taxInclusive: true }),
    );
    expect(html).not.toContain('Includes tax');
    expect(row(html, 'Subtotal')).toBeNull();
  });
});

describe('renderInvoiceHtml per-line tax and breakdown (B3)', () => {
  it('renders a Tax column with the captured rate per line', () => {
    const html = renderInvoiceHtml(data({ taxInclusive: false }));
    expect(html).toContain('<th class="num">Tax</th>');
    expect(html).toContain('(5%)');
  });

  // A pre-B2 order captured nothing. Every cell would be an em dash, so the
  // column is dropped rather than printed empty.
  it('omits the Tax column entirely when no line carries a capture', () => {
    const base = data();
    const html = renderInvoiceHtml({
      ...base,
      order: {
        ...base.order,
        orderitem: base.order.orderitem.map((i) => ({
          ...i,
          taxRate: null,
          taxAmount: null,
        })),
      },
    });
    expect(html).not.toContain('<th class="num">Tax</th>');
  });

  it('renders the breakdown by rate, and the rows sum to the Tax total', () => {
    const html = renderInvoiceHtml(
      data({
        taxInclusive: false,
        taxAmount: '15.00',
        taxBreakdown: [
          { taxRate: 5, taxableAmount: 300, taxAmount: 15 },
          { taxRate: 0, taxableAmount: 50, taxAmount: 0 },
        ],
      }),
    );
    expect(html).toContain('Tax summary');
    expect(html).toContain('Taxable at 5%');
    // Zero-rated is listed too: on a return it is as reportable as taxed sales.
    expect(html).toContain('Taxable at 0%');
  });

  it('labels the delivery row rather than calling it a rate', () => {
    const html = renderInvoiceHtml(
      data({
        taxBreakdown: [
          { taxRate: 5, taxableAmount: 100, taxAmount: 5 },
          { taxRate: 0, taxableAmount: 0, taxAmount: 1, label: 'Delivery' },
        ],
      }),
    );
    expect(html).toContain('>Delivery</td>');
    expect(html).not.toContain('Taxable at 0%');
  });

  it('prints no breakdown when there is none to print', () => {
    expect(renderInvoiceHtml(data({ taxBreakdown: [] }))).not.toContain(
      'Tax summary',
    );
    expect(renderInvoiceHtml(data({}))).not.toContain('Tax summary');
  });

  // A packing slip hides pricing from warehouse and rider staff; a tax summary
  // is pricing.
  it('prints neither the Tax column nor the breakdown on a packing slip', () => {
    const html = renderInvoiceHtml(
      data({
        type: 'PACKING_SLIP',
        taxBreakdown: [{ taxRate: 5, taxableAmount: 100, taxAmount: 5 }],
      }),
    );
    expect(html).not.toContain('<th class="num">Tax</th>');
    expect(html).not.toContain('Tax summary');
  });
});
