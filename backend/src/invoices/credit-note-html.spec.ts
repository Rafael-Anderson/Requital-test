import { renderInvoiceHtml, type InvoiceHtmlData } from './invoice-html';

const base = (currency: string, total: string): InvoiceHtmlData => ({
  invoiceNumber: 'CN-0001',
  type: 'CREDIT_NOTE',
  issuedAt: new Date('2026-10-01T10:00:00Z'),
  creditNote: {
    originalInvoiceNumber: 'INV-0042',
    originalInvoiceIssuedAt: new Date('2026-09-30T10:00:00Z'),
    reason: 'return',
  },
  subtotal: total,
  taxAmount: '0',
  total,
  notes: null,
  shopName: 'Shop',
  shopAddress: null,
  shopEmail: null,
  currency,
  order: {
    id: 1,
    shopOrderNumber: 7,
    customerName: 'C',
    customerPhone: '1',
    customerEmail: null,
    customerAddress: 'A',
    regionName: null,
    area: null,
    createdAt: new Date('2026-09-30T09:00:00Z'),
    deliveryFee: null,
    discountAmount: null,
    discountCode: null,
    // A COD order must NOT grow a "Cash Due" box on a credit note.
    paymentMethod: 'cash_on_delivery',
    paymentStatus: 'pending',
    orderitem: [
      { productName: 'Rose', variantLabel: null, quantity: 1, priceAtPurchase: total, autoDiscountAmount: null },
    ],
  },
});

describe('credit note rendering', () => {
  it('is titled Credit Note, references the original invoice, and shows no cash-due box', () => {
    const html = renderInvoiceHtml(base('AED', '52.5'));
    expect(html).toContain('<p class="doc-title">Credit Note</p>');
    expect(html).toContain('Against invoice INV-0042');
    expect(html).toContain('Total credited');
    expect(html).not.toContain('Cash Due');
  });

  it('formats money with the credit note\'s own currency decimals (KWD = 3)', () => {
    const html = renderInvoiceHtml(base('KWD', '11.03'));
    expect(html).toContain('KWD 11.030');
    expect(html).not.toContain('KWD 11.03<');
  });
});
