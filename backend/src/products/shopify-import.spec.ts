import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsv } from '../common/csv.util';
import {
  decimalEquals,
  gramsToKilograms,
  looksLikeShopifyExport,
  mapShopifyRows,
  normalizeDecimal,
  parseDecimalString,
} from './shopify-import';

function load(text: string) {
  const rows = parseCsv(text);
  return mapShopifyRows(rows, rows.length ? Object.keys(rows[0]) : []);
}
const fixture = readFileSync(
  join(__dirname, '../../test/fixtures/shopify-products.csv'),
  'utf-8',
);

const HEADER =
  'Handle,Title,Body (HTML),Vendor,Type,Tags,Published,Option1 Name,Option1 Value,Option2 Name,Option2 Value,Option3 Name,Option3 Value,Variant SKU,Variant Grams,Variant Inventory Tracker,Variant Inventory Qty,Variant Inventory Policy,Variant Price,Variant Compare At Price,Variant Requires Shipping,Variant Taxable,Image Src,Image Position,Status,Cost per item';

describe('exact decimals', () => {
  it('keeps the exported string and never goes through a float', () => {
    expect(parseDecimalString('10.505')).toEqual({ value: '10.505' });
    expect(parseDecimalString('  0.1 ')).toEqual({ value: '0.1' });
    expect(parseDecimalString('')).toEqual({ value: null });
    expect(parseDecimalString(undefined)).toEqual({ value: null });
    // A value no double can hold stays exact.
    expect(parseDecimalString('12345678.12345678').value).toBe(
      '12345678.12345678',
    );
  });

  it.each([
    '12,50',
    '1e3',
    '-5',
    '$5',
    'abc',
    '1.2.3',
    '.5',
    '5.',
    '1 000',
    '0x10',
    '1234567890123.1',
  ])('rejects %j', (input) => {
    expect(parseDecimalString(input).error).toBeDefined();
  });

  it('compares decimals without floating point', () => {
    expect(decimalEquals('10.50', '10.5')).toBe(true);
    expect(decimalEquals('010.5', '10.500000')).toBe(true);
    expect(decimalEquals('0.1', '0.10000000000000000000000000001')).toBe(false);
    expect(decimalEquals('150.000000000000000000000000000000', '150')).toBe(
      true,
    );
    expect(decimalEquals(null, null)).toBe(true);
    expect(decimalEquals(null, '0')).toBe(false);
    expect(normalizeDecimal('0.000')).toBe('0');
  });

  it('converts grams to kilograms by moving the decimal point', () => {
    expect(gramsToKilograms('1500')).toBe('1.5');
    expect(gramsToKilograms('250')).toBe('0.25');
    expect(gramsToKilograms('5')).toBe('0.005');
    expect(gramsToKilograms('0')).toBe('0');
    expect(gramsToKilograms('1234567')).toBe('1234.567');
    expect(gramsToKilograms('250.5')).toBe('0.2505');
  });
});

describe('mapShopifyRows: the realistic fixture', () => {
  const result = load(fixture);
  const byHandle = new Map(result.products.map((p) => [p.handle, p]));

  it('reads past the BOM, CRLF and quoted newlines', () => {
    expect(result.products.map((p) => p.handle)).toEqual([
      'red-rose-bouquet',
      'ceramic-vase',
      'gift-wrap',
      'formula-title',
      'Bad-Handle',
      'broken-price',
      'no-image-item',
    ]);
    expect(byHandle.get('red-rose-bouquet')!.bodyHtml).toContain('\n');
  });

  it('groups rows by Handle into one product with variants and images', () => {
    const rose = byHandle.get('red-rose-bouquet')!;
    expect(rose.errors).toEqual([]);
    expect(rose.optionNames).toEqual(['Size', 'Ribbon']);
    expect(rose.variants).toHaveLength(3);
    expect(rose.variants.map((v) => v.optionValues)).toEqual([
      ['Small', 'Red'],
      ['Large', 'Red'],
      ['Large', 'Gold'],
    ]);
    expect(rose.variants.map((v) => v.sku)).toEqual([
      'RRB-S-RED',
      'RRB-L-RED',
      'RRB-L-GOLD',
    ]);
    // The image-only row added a third image, in position order.
    expect(rose.images.map((i) => i.position)).toEqual([1, 2, 3]);
  });

  it('maps money as exact strings, NULL when blank, never 0', () => {
    const rose = byHandle.get('red-rose-bouquet')!;
    expect(rose.variants.map((v) => v.price)).toEqual([
      '150.00',
      '220.50',
      '235.00',
    ]);
    expect(rose.variants.map((v) => v.compareAtPrice)).toEqual([
      '180.00',
      '250.00',
      null,
    ]);
    expect(rose.variants.map((v) => v.cost)).toEqual(['80.25', '110.10', null]);
    const vase = byHandle.get('ceramic-vase')!;
    expect(vase.variants[0].compareAtPrice).toBeNull();
    expect(vase.variants[0].cost).toBeNull();
  });

  it('maps weight, inventory and the per-variant image', () => {
    const rose = byHandle.get('red-rose-bouquet')!;
    expect(rose.variants.map((v) => v.weightKg)).toEqual([
      '1.5',
      '2.25',
      '2.3',
    ]);
    expect(rose.variants.map((v) => v.quantity)).toEqual([12, 5, 0]);
    expect(rose.variants.map((v) => v.continueSelling)).toEqual([
      false,
      true,
      false,
    ]);
    expect(rose.variants[1].imageUrl).toContain('rose-2.jpg');
    expect(rose.variants.every((v) => v.tracked)).toBe(true);
  });

  it('maps product-level fields', () => {
    const rose = byHandle.get('red-rose-bouquet')!;
    expect(rose.title).toBe('Red Rose Bouquet');
    expect(rose.vendor).toBe('Petal & Co');
    expect(rose.productType).toBe('Bouquet');
    expect(rose.tags).toEqual(['roses', 'red', 'Valentine']);
    expect(rose.seoTitle).toBe('Red Rose Bouquet | Petal & Co');
    expect(rose.seoDescription).toBe('Fresh red roses delivered today.');
    expect(rose.status).toBe('Available');
  });

  it('treats the Default Title option as no option at all', () => {
    const vase = byHandle.get('ceramic-vase')!;
    expect(vase.optionNames).toEqual([]);
    expect(vase.variants).toHaveLength(1);
    expect(vase.variants[0].optionValues).toEqual([]);
    expect(vase.variants[0].tracked).toBe(true);
    expect(vase.variants[0].quantity).toBe(7);
  });

  it('maps Status and taxable/shipping flags', () => {
    expect(byHandle.get('ceramic-vase')!.status).toBe('Unavailable');
    expect(byHandle.get('gift-wrap')!.status).toBe('Archived');
    const wrap = byHandle.get('gift-wrap')!.variants[0];
    expect(wrap.taxable).toBe(false);
    expect(wrap.requiresShipping).toBe(false);
    expect(wrap.tracked).toBe(false);
    expect(wrap.quantity).toBeNull();
  });

  it('keeps formula-looking cells as plain strings', () => {
    const formula = byHandle.get('formula-title')!;
    expect(formula.title).toBe('=HYPERLINK("http://evil.example","click")');
    expect(formula.vendor).toBe('@vendor');
  });

  it('reports row-level errors per product', () => {
    expect(byHandle.get('Bad-Handle')!.errors.join(' ')).toMatch(/lowercase/);
    expect(byHandle.get('broken-price')!.errors.join(' ')).toMatch(
      /Variant Price.*not a plain decimal/,
    );
    expect(byHandle.get('no-image-item')!.images).toHaveLength(0);
  });

  it('reports unsupported columns that hold data and the ignored alt text', () => {
    expect(result.unsupportedColumns).toEqual(['Google Shopping / Gender']);
    expect(result.warnings.join(' ')).toMatch(/alt text/i);
  });
});

describe('mapShopifyRows: edge cases', () => {
  it('merges non-contiguous rows of one handle and warns', () => {
    const result = load(
      [
        HEADER,
        'a,A,,,,,true,Size,S,,,,,A-S,,,,,5,,,,i1.jpg,1,active,',
        'b,B,,,,,true,Title,Default Title,,,,,B-1,,,,,6,,,,i2.jpg,1,active,',
        'a,,,,,,,,M,,,,,A-M,,,,,7,,,,,,,',
      ].join('\n'),
    );
    const a = result.products.find((p) => p.handle === 'a')!;
    expect(a.variants).toHaveLength(2);
    expect(result.warnings.join(' ')).toMatch(/not next to each other/);
  });

  it('flags duplicate option combinations and a missing option value', () => {
    const dup = load(
      [
        HEADER,
        'a,A,,,,,true,Size,S,,,,,A-1,,,,,5,,,,i.jpg,1,active,',
        'a,,,,,,,,S,,,,,A-2,,,,,6,,,,,,,',
      ].join('\n'),
    ).products[0];
    expect(dup.errors.join(' ')).toMatch(/already has these option values/);
    const missing = load(
      [
        HEADER,
        'a,A,,,,,true,Size,S,Color,,,,A-1,,,,,5,,,,i.jpg,1,active,',
      ].join('\n'),
    ).products[0];
    expect(missing.errors.join(' ')).toMatch(/Option2 Value is required/);
  });

  it('rejects more than three options and more than the variant cap', () => {
    const rows = [HEADER];
    rows.push('a,A,,,,,true,Size,S,Color,R,,,A-0,,,,,5,,,,i.jpg,1,active,');
    for (let i = 1; i <= 100; i += 1)
      rows.push(`a,,,,,,,,S${i},,R,,,A-${i},,,,,5,,,,,,,`);
    const p = load(rows.join('\n')).products[0];
    expect(p.errors.join(' ')).toMatch(/at most 100 variants/);
  });

  it('needs Option1 Name when there are several variants', () => {
    const p = load(
      [
        HEADER,
        'a,A,,,,,true,,,,,,,A-1,,,,,5,,,,i.jpg,1,active,',
        'a,,,,,,,,,,,,,A-2,,,,,6,,,,,,,',
      ].join('\n'),
    ).products[0];
    expect(p.errors.join(' ')).toMatch(/Option1 Name/);
  });

  it('requires a price on every variant and a title on the first row', () => {
    const p = load(
      [
        HEADER,
        'a,,,,,,true,Title,Default Title,,,,,A-1,,,,,,,,,i.jpg,1,active,',
      ].join('\n'),
    ).products[0];
    expect(p.errors).toEqual(
      expect.arrayContaining([
        'Title is required',
        expect.stringMatching(/Variant Price is required/),
      ]),
    );
  });

  it('rejects a bad quantity but ignores quantity on an untracked variant', () => {
    const bad = load(
      [
        HEADER,
        'a,A,,,,,true,Title,Default Title,,,,,A-1,,shopify,twelve,,5,,,,i.jpg,1,active,',
      ].join('\n'),
    ).products[0];
    expect(bad.errors.join(' ')).toMatch(/not a whole number/);
    const untracked = load(
      [
        HEADER,
        'a,A,,,,,true,Title,Default Title,,,,,A-1,,,40,,5,,,,i.jpg,1,active,',
      ].join('\n'),
    ).products[0];
    expect(untracked.variants[0].quantity).toBeNull();
    const negative = load(
      [
        HEADER,
        'a,A,,,,,true,Title,Default Title,,,,,A-1,,shopify,-3,,5,,,,i.jpg,1,active,',
      ].join('\n'),
    ).products[0];
    expect(negative.variants[0].quantity).toBe(-3);
  });

  it('skips unusable image URLs with a warning and never throws', () => {
    const rows = [
      HEADER,
      'a,A,,,,,true,Title,Default Title,,,,,A-1,,,,,5,,,,javascript:alert(1),1,active,',
      'a,,,,,,,,,,,,,,,,,,,,,,data:image/png;base64,AAAA,2,,',
      'a,,,,,,,,,,,,,,,,,,,,,,https://cdn.example/ok.jpg,3,,',
      `a,,,,,,,,,,,,,,,,,,,,,,https://cdn.example/${'x'.repeat(200)}.jpg,4,,`,
      'a,,,,,,,,,,,,,,,,,,,,,,https://cdn.example/ok.jpg,5,,',
    ];
    const p = load(rows.join('\n')).products[0];
    expect(p.images.map((i) => i.url)).toEqual(['https://cdn.example/ok.jpg']);
    expect(p.warnings.length).toBe(3);
  });

  it('maps Status and Published for older exports without a Status column', () => {
    const header = HEADER.replace(',Status', '');
    const p = load(
      [
        header,
        'a,A,,,,,false,Title,Default Title,,,,,A-1,,,,,5,,,,i.jpg,1,',
      ].join('\n'),
    ).products[0];
    expect(p.status).toBe('Unavailable');
    const unknown = load(
      [
        HEADER,
        'a,A,,,,,true,Title,Default Title,,,,,A-1,,,,,5,,,,i.jpg,1,weird,',
      ].join('\n'),
    ).products[0];
    expect(unknown.errors.join(' ')).toMatch(/Unknown Status/);
  });

  it('skips a row with no handle and reports it', () => {
    const result = load(
      [
        HEADER,
        ',Orphan,,,,,true,Title,Default Title,,,,,,,,,,5,,,,,,active,',
      ].join('\n'),
    );
    expect(result.products).toEqual([]);
    expect(result.rowIssues).toEqual([
      { rowNumber: 2, message: 'Row has no Handle and was skipped' },
    ]);
  });

  it('shortens an over-long title with a warning instead of failing', () => {
    const p = load(
      [
        HEADER,
        `a,${'T'.repeat(300)},,,,,true,Title,Default Title,,,,,A-1,,,,,5,,,,i.jpg,1,active,`,
      ].join('\n'),
    ).products[0];
    expect(p.title).toHaveLength(191);
    expect(p.warnings.join(' ')).toMatch(/Title was longer/);
  });

  it('refuses to import a gift card as an ordinary product', () => {
    const header = HEADER + ',Gift Card';
    const p = load(
      [
        header,
        'a,A,,,,,true,Title,Default Title,,,,,A-1,,,,,5,,,,i.jpg,1,active,,true',
      ].join('\n'),
    ).products[0];
    expect(p.errors.join(' ')).toMatch(/Gift cards/);
  });

  it('recognises a Shopify export by its header', () => {
    expect(looksLikeShopifyExport(['Handle', 'Title', 'Variant Price'])).toBe(
      true,
    );
    expect(
      looksLikeShopifyExport(['Handle', 'Name', 'Description', 'SKU']),
    ).toBe(false);
    expect(looksLikeShopifyExport([])).toBe(false);
  });
});
