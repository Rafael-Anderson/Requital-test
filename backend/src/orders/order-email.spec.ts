import {
  buildBillRows,
  esc,
  lineMinor,
  renderOrderConfirmationHtml,
  renderOrderConfirmationText,
  renderTrackBlockHtml,
  type OrderEmailData,
} from './order-email';
import { trackingLink } from './order-email-data';
import { emailAssetUrl } from '../common/email-asset-url';
import { minorToDecimal } from '../drivers/cash';

// Whole-unit test amounts to a decimal string, through the codebase's own helper.
const dec = (units: number) => minorToDecimal(units * 100, 'AED');

const TOKEN = 'A1B2C3D4E5F60718293A4B5C6D7E8F90';

function base(over: Partial<OrderEmailData> = {}): OrderEmailData {
  return {
    orderNumber: 42,
    createdAtText: '14 Nov 2026, 10:30',
    currency: 'AED',
    orderType: 'delivery',
    paymentMethod: 'card_online',
    paymentStatus: 'unpaid',
    customerName: 'Sara Customer',
    customerEmail: 'sara@example.com',
    customerPhone: '0500000001',
    address: 'Villa 3, Palm Street',
    area: 'Jumeirah',
    regionName: 'Dubai',
    deliveryDateText: 'Sat, 21 Nov 2026',
    deliveryTimeSlot: '10:00 - 12:00',
    deliveryNotes: null,
    giftMessage: null,
    pickupOutletName: null,
    lines: [
      {
        name: 'Red roses',
        variantLabel: 'Large',
        quantity: 2,
        unitPrice: '100.00',
        note: null,
        imageUrl: 'https://api.requital.io/uploads/roses.jpg',
      },
    ],
    deliveryFee: '0',
    taxAmount: null,
    discountAmount: null,
    discountCode: null,
    giftCardAmount: null,
    storeCreditAmount: null,
    total: '200.00',
    shopName: 'Bloom Shop',
    shopLogoUrl: null,
    shopEmail: 'hello@bloom.test',
    shopPhone: '+971501234567',
    trackUrl: `https://bloom.requital.io/orders/${TOKEN}`,
    rtl: false,
    ...over,
  };
}

const labels = (d: OrderEmailData) => buildBillRows(d).map((r) => r.label);
const rowOf = (d: OrderEmailData, label: string) =>
  buildBillRows(d).find((r) => r.label === label);

describe('lineMinor (exact, rounded once per line)', () => {
  it('rounds the line, not the unit: 10.505 x 3 is 31.52', () => {
    expect(lineMinor('10.505', 3, 'AED')).toBe(3152);
  });
  it('uses the currency width: KWD has 3 decimals', () => {
    expect(lineMinor('10.505', 3, 'KWD')).toBe(31515);
  });
  it('rejects an unreadable price instead of guessing', () => {
    expect(lineMinor('abc', 1, 'AED')).toBeNull();
    expect(lineMinor('5', 0, 'AED')).toBeNull();
  });
});

// Every combination of discount / delivery fee / tax / gift card / store credit /
// COD. The figures are what the order would have FROZEN: total is built the way
// checkout builds it (tax-exclusive here), and the email must read them back.
describe('bill split: every combination of the optional rows', () => {
  const subtotal = 200;
  const cases: {
    discount: boolean;
    delivery: boolean;
    tax: boolean;
    gift: boolean;
    credit: boolean;
    cod: boolean;
  }[] = [];
  for (let m = 0; m < 64; m++) {
    cases.push({
      discount: !!(m & 1),
      delivery: !!(m & 2),
      tax: !!(m & 4),
      gift: !!(m & 8),
      credit: !!(m & 16),
      cod: !!(m & 32),
    });
  }

  it.each(cases)('%j', (c) => {
    const discount = c.discount ? 20 : 0;
    const delivery = c.delivery ? 15 : 0;
    const tax = c.tax ? 9 : 0;
    const total = subtotal - discount + delivery + tax;
    const gift = c.gift ? 30 : 0;
    const credit = c.credit ? 25 : 0;
    const d = base({
      paymentMethod: c.cod ? 'cash_on_delivery' : 'card_online',
      deliveryFee: c.delivery ? '15.00' : '0',
      taxAmount: c.tax ? '9.00' : null,
      discountAmount: c.discount ? '20.00' : null,
      discountCode: c.discount ? 'SAVE10' : null,
      giftCardAmount: c.gift ? '30.00' : null,
      storeCreditAmount: c.credit ? '25.00' : null,
      total: dec(total),
    });
    const rows = buildBillRows(d);
    const text = rows.map((r) => `${r.label}|${r.value}`);

    expect(rows[0]).toEqual({
      label: 'Subtotal',
      value: '200.00 AED',
      kind: 'normal',
    });
    expect(text).toContain(`Total|${dec(total)} AED`);
    expect(labels(d).includes('Discount (SAVE10)')).toBe(c.discount);
    expect(text.includes('Delivery fee|15.00 AED')).toBe(c.delivery);
    // A delivery order with a stored fee of 0 says "Free" rather than hiding it.
    expect(text.includes('Delivery fee|Free')).toBe(!c.delivery);
    expect(text.includes('VAT|9.00 AED')).toBe(c.tax);
    expect(labels(d).includes('Paid by gift card')).toBe(c.gift);
    expect(labels(d).includes('Paid by store credit')).toBe(c.credit);

    const due = total - gift - credit;
    if (c.cod) {
      expect(text).toContain(`Amount due on delivery|${dec(due)} AED`);
    } else if (c.gift || c.credit) {
      expect(text).toContain(`Amount to pay|${dec(due)} AED`);
    } else {
      expect(labels(d).some((l) => l.startsWith('Amount'))).toBe(false);
    }
    // Total is always the frozen order total, never the sum of the rows above.
    expect(rowOf(d, 'Total')!.kind).toBe('total');
  });

  it('a pickup order has no delivery row and says "due on pickup" for cash', () => {
    const d = base({
      orderType: 'pickup',
      paymentMethod: 'cash_on_pickup',
      deliveryFee: null,
    });
    expect(labels(d)).not.toContain('Delivery fee');
    expect(rowOf(d, 'Amount due on pickup')!.value).toBe('200.00 AED');
  });

  it('a NULL delivery fee is unknown and is left out, never shown as free', () => {
    expect(labels(base({ deliveryFee: null }))).not.toContain('Delivery fee');
  });

  it('tax-inclusive orders say the VAT is included', () => {
    // 200 goods, 10 VAT already inside it, no delivery: total stays 200.
    const d = base({ taxAmount: '10.00', total: '200.00' });
    expect(labels(d)).toContain('VAT (included in the prices)');
  });

  it('a cash order fully covered by a gift card shows an amount due of zero', () => {
    const d = base({
      paymentMethod: 'cash_on_delivery',
      giftCardAmount: '200.00',
    });
    expect(rowOf(d, 'Amount due on delivery')!.value).toBe('0.00 AED');
  });

  it('keeps three decimals for KWD', () => {
    const d = base({
      currency: 'KWD',
      lines: [
        {
          name: 'Oud',
          variantLabel: null,
          quantity: 3,
          unitPrice: '10.505',
          note: null,
          imageUrl: null,
        },
      ],
      deliveryFee: '0',
      total: '31.515',
    });
    expect(rowOf(d, 'Subtotal')!.value).toBe('31.515 KWD');
    expect(rowOf(d, 'Total')!.value).toBe('31.515 KWD');
  });

  it('uses the shared ISO-code formatting, never a symbol', () => {
    const html = renderOrderConfirmationHtml(base());
    expect(html).toContain('200.00 AED');
    expect(html).not.toMatch(/&#1[0-9]{4};|Ð|⃃/);
  });
});

describe('confirmation email content', () => {
  const html = renderOrderConfirmationHtml(base());
  const text = renderOrderConfirmationText(base());

  it('has the Track button, the plain URL beneath it, and the same URL in the text part', () => {
    expect(html).toContain('Track your order</a>');
    expect(html).toContain(`href="https://bloom.requital.io/orders/${TOKEN}"`);
    expect(html).toContain('Or copy this link into your browser:');
    expect(html).toContain(
      `>https://bloom.requital.io/orders/${TOKEN}</a></p>`,
    );
    expect(text).toContain(
      `Track your order: https://bloom.requital.io/orders/${TOKEN}`,
    );
  });

  it('shows the order number, date, shop name, items, payment and delivery details', () => {
    expect(html).toContain('#42');
    expect(html).toContain('14 Nov 2026, 10:30');
    expect(html).toContain('Bloom Shop');
    expect(html).toContain('Red roses');
    expect(html).toContain('Large');
    expect(html).toContain('2 &times; 100.00 AED');
    expect(html).toContain('200.00 AED');
    expect(html).toContain('<img src="https://api.requital.io/uploads/roses.jpg"');
    expect(html).toContain('Card (online)');
    expect(html).toContain('Awaiting payment');
    expect(html).toContain('Villa 3, Palm Street, Jumeirah, Dubai');
    expect(html).toContain('Sat, 21 Nov 2026');
    expect(html).toContain('10:00 - 12:00');
    expect(html).toContain('sara@example.com');
    expect(html).toContain('0500000001');
    expect(html).toContain('hello@bloom.test');
    expect(html).toContain('+971501234567');
    expect(text).toContain('Red roses (Large): 2 x 100.00 AED = 200.00 AED');
    expect(text).toContain('Payment method: Card (online)');
  });

  it('shows delivery notes and the gift message only when present', () => {
    expect(html).not.toContain('Delivery notes');
    expect(html).not.toContain('Gift message');
    const d = base({
      deliveryNotes: 'Ring twice',
      giftMessage: 'Happy birthday!',
    });
    const withNotes = renderOrderConfirmationHtml(d);
    expect(withNotes).toContain('Ring twice');
    expect(withNotes).toContain('Happy birthday!');
    expect(renderOrderConfirmationText(d)).toContain('Gift message: Happy birthday!');
  });

  it('shows the pickup location for a pickup order', () => {
    const d = base({
      orderType: 'pickup',
      pickupOutletName: 'Main Branch',
      address: null,
      area: null,
      regionName: null,
    });
    const h = renderOrderConfirmationHtml(d);
    expect(h).toContain('Pickup location');
    expect(h).toContain('Main Branch');
    expect(h).not.toContain('Delivery address');
  });

  it('omits the Track block (never invents a link) when the order has no token', () => {
    const d = base({ trackUrl: null });
    expect(renderOrderConfirmationHtml(d)).not.toContain('Track your order');
    expect(renderOrderConfirmationText(d)).not.toContain('Track your order');
  });

  it('uses the shop logo when it has an https one, else the shop name', () => {
    expect(html).toContain('>Bloom Shop</span>');
    const withLogo = renderOrderConfirmationHtml(
      base({ shopLogoUrl: 'https://api.requital.io/uploads/logo.png' }),
    );
    expect(withLogo).toContain('<img src="https://api.requital.io/uploads/logo.png"');
  });

  it('keeps the shared layout markers every order email carries', () => {
    expect(html).toContain('#0d9488');
    expect(html).toContain('Requital');
    expect(html).toContain('&copy; 2026 Requital');
  });

  it('is table based, mobile friendly and left to right by default', () => {
    expect(html).toContain('role="presentation"');
    expect(html).toContain('max-width:600px;width:100%');
    expect(html).toContain('dir="ltr"');
    expect(html).not.toMatch(/<div[^>]*display:flex/);
  });

  it('lays out right to left for an Arabic shop', () => {
    const rtl = renderOrderConfirmationHtml(base({ rtl: true }));
    expect(rtl).toContain('dir="rtl"');
    expect(rtl).toContain('direction:rtl');
    expect(rtl).toContain('text-align:right');
  });
});

describe('HTML escaping of every customer and merchant typed value', () => {
  const evil = `<script>alert(1)</script>"><img src=x onerror=alert(2)>'`;
  const d = base({
    customerName: evil,
    customerEmail: evil,
    customerPhone: evil,
    address: evil,
    area: evil,
    regionName: evil,
    deliveryTimeSlot: evil,
    deliveryNotes: evil,
    giftMessage: evil,
    discountAmount: '5.00',
    discountCode: evil,
    shopName: evil,
    shopEmail: evil,
    shopPhone: evil,
    lines: [
      {
        name: evil,
        variantLabel: evil,
        quantity: 1,
        unitPrice: '200.00',
        note: evil,
        imageUrl: 'https://api.requital.io/uploads/a.jpg',
      },
    ],
    total: '195.00',
  });
  const html = renderOrderConfirmationHtml(d);

  it('never emits a raw tag, attribute break or event handler from user text', () => {
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img src=x');
    // The text "onerror=..." may appear as inert escaped text, but never inside a tag.
    // Judged on the tag structure: quoted attribute values blanked first.
    const structure = html.replace(/="[^"]*"/g, '=""');
    expect(structure).not.toMatch(/<[^>]*\son\w+\s*=/i);
    // The only <img> tags are ours (thumbnail), with an escaped alt.
    const imgs = html.match(/<img [^>]*>/g) ?? [];
    expect(imgs).toHaveLength(1);
    expect(imgs[0]).toContain('alt="&lt;script&gt;');
    expect(imgs[0]).not.toMatch(/alt="[^"]*"[^>]*onerror/);
  });

  it('escapes quotes so a value cannot leave an attribute', () => {
    expect(esc(`a"b'c<d>&`)).toBe('a&quot;b&#39;c&lt;d&gt;&amp;');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;&quot;&gt;');
  });

  it('keeps hostile text inert in the plain-text part too (no HTML in it)', () => {
    const text = renderOrderConfirmationText(d);
    expect(text).not.toContain('<b>');
    expect(text.split('\n').every((l) => !l.includes('\r'))).toBe(true);
  });

  it('a hostile tracking URL cannot break out of the href', () => {
    const block = renderTrackBlockHtml('https://x.test/"><script>1</script>');
    expect(block).not.toContain('<script');
    expect(block).toContain('&quot;&gt;&lt;script&gt;');
  });

  it('newlines in notes become line breaks, not markup', () => {
    const h = renderOrderConfirmationHtml(
      base({ deliveryNotes: 'line one\nline two' }),
    );
    expect(h).toContain('line one<br>line two');
  });
});

describe('the link uses the shop own domain', () => {
  const OLD = process.env.STOREFRONT_URL;
  beforeAll(() => {
    delete process.env.STOREFRONT_URL;
  });
  afterAll(() => {
    if (OLD !== undefined) process.env.STOREFRONT_URL = OLD;
  });

  const shop = {
    subdomain: 'bloom',
    domainType: 'subdomain',
    customDomain: null,
    customDomainStatus: null,
  };

  it('a platform shop links to its own subdomain host', () => {
    expect(trackingLink(TOKEN, shop)).toBe(
      `https://bloom.requital.io/orders/${TOKEN}`,
    );
  });

  it('a VERIFIED custom domain is used', () => {
    expect(
      trackingLink(TOKEN, {
        ...shop,
        domainType: 'custom',
        customDomain: 'shop.bloom.test',
        customDomainStatus: 'verified',
      }),
    ).toBe(`https://shop.bloom.test/orders/${TOKEN}`);
  });

  it('an unverified custom domain claim is NOT used', () => {
    expect(
      trackingLink(TOKEN, {
        ...shop,
        domainType: 'custom',
        customDomain: 'victim.example',
        customDomainStatus: 'pending',
      }),
    ).toBe(`https://bloom.requital.io/orders/${TOKEN}`);
  });

  it('two shops never share a link', () => {
    const a = trackingLink(TOKEN, shop)!;
    const b = trackingLink(TOKEN, { ...shop, subdomain: 'other' })!;
    expect(a).not.toBe(b);
    expect(b).toContain('other.requital.io');
  });

  it('only a real token shape is linked: no token, a short id or junk gives no link', () => {
    expect(trackingLink(null, shop)).toBeNull();
    expect(trackingLink('42', shop)).toBeNull();
    expect(trackingLink('../../admin', shop)).toBeNull();
    expect(trackingLink(`${TOKEN}x`, shop)).toBeNull();
  });
});

describe('emailAssetUrl', () => {
  it('keeps https, resolves uploads against the API host, drops the rest', () => {
    expect(emailAssetUrl('https://cdn.test/a.png')).toBe('https://cdn.test/a.png');
    expect(emailAssetUrl('/uploads/x/y.png')).toBe(
      'https://api.requital.io/uploads/x/y.png',
    );
    expect(emailAssetUrl('http://cdn.test/a.png')).toBeNull();
    expect(emailAssetUrl('javascript:alert(1)')).toBeNull();
    expect(emailAssetUrl('data:image/png;base64,AAAA')).toBeNull();
    expect(emailAssetUrl('/uploads/a b.png')).toBeNull();
    expect(emailAssetUrl(null)).toBeNull();
  });
});
