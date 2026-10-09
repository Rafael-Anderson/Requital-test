import {
  PlatformColumnsError,
  compareDecimal,
  deriveHandle,
  mapPlatformRows,
  normaliseHeader,
  splitUrls,
  toAsciiNumber,
} from './platform-import';
import { SALLA_SPEC } from './salla-import';
import { ZID_SPEC } from './zid-import';

function table(rows: string[][]): {
  rows: Record<string, string>[];
  headers: string[];
} {
  const [header, ...data] = rows;
  return {
    headers: header,
    rows: data.map((r) =>
      Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])),
    ),
  };
}

function salla(rows: string[][]) {
  const t = table(rows);
  return mapPlatformRows(SALLA_SPEC, t.rows, t.headers);
}
function zid(rows: string[][]) {
  const t = table(rows);
  return mapPlatformRows(ZID_SPEC, t.rows, t.headers);
}

describe('normaliseHeader', () => {
  it.each([
    ['\ufeffProduct Name', 'product name'],
    ['  PRICE  ', 'price'],
    ['أسم الخيار[1]', 'اسم الخيار 1'],
    ['اسم الخيار 1', 'اسم الخيار 1'],
    ['Option1 Name', 'option 1 name'],
    ['option_1_name', 'option 1 name'],
    ['هل يتطلب شحن؟', 'هل يتطلب شحن'],
    ['رمز المنتج SKU', 'رمز المنتج sku'],
    ['السِّعْر', 'السعر'],
    ['ســعر', 'سعر'],
    ['\u200fاسم المنتج\u200e', 'اسم المنتج'],
    ['Sale-Price', 'sale price'],
  ])('%p -> %p', (raw, expected) => {
    expect(normaliseHeader(raw)).toBe(expected);
  });
});

describe('numbers', () => {
  it.each([
    ['١٠٫٥٠٥', '10.505'],
    ['۱۲۳', '123'],
    ['1,234.50', '1234.50'],
    ['1,234,567', '1234567'],
    ['12,5', '12,5'], // ambiguous: left alone so the decimal parser rejects it
    [' 150 ', '150'],
  ])('toAsciiNumber(%p) = %p', (raw, expected) => {
    expect(toAsciiNumber(raw)).toBe(expected);
  });

  it.each([
    ['1', '2', -1],
    ['2', '1', 1],
    ['10', '9', 1],
    ['9.99', '10', -1],
    ['10.50', '10.5', 0],
    ['0.1', '0.10', 0],
    ['10.505', '10.504', 1],
    ['00012', '12', 0],
    ['100000000000.1', '99999999999.9', 1],
  ])('compareDecimal(%s, %s) = %d', (a, b, expected) => {
    expect(compareDecimal(a, b)).toBe(expected);
  });

  it('splits image cells', () => {
    expect(
      splitUrls(
        'https://a.test/1.jpg, https://a.test/2.jpg|https://a.test/3.jpg\nhttps://a.test/4.jpg',
      ),
    ).toEqual([
      'https://a.test/1.jpg',
      'https://a.test/2.jpg',
      'https://a.test/3.jpg',
      'https://a.test/4.jpg',
    ]);
    expect(splitUrls('https://a.test/x,y.jpg')).toEqual([
      'https://a.test/x,y.jpg',
    ]);
    expect(splitUrls('  ')).toEqual([]);
  });

  it('derives deterministic handles that keep Arabic', () => {
    expect(deriveHandle('Red Roses 12 pcs!')).toBe('red-roses-12-pcs');
    expect(deriveHandle('باقة ورد جوري')).toBe('باقة-ورد-جوري');
    expect(deriveHandle('باقة ورد جوري')).toBe(deriveHandle('باقة ورد جوري'));
    expect(deriveHandle('🌹🌹')).toMatch(/^product-[0-9a-f]{8}$/);
    expect(deriveHandle('مُنتَج')).toBe('منتج');
  });
});

describe('Salla mapper', () => {
  const ARABIC_HEADER = [
    'النوع',
    'أسم المنتج',
    'تصنيف المنتج',
    'صورة المنتج',
    'الوصف',
    'سعر المنتج',
    'السعر المخفض',
    'سعر التكلفة',
    'رمز المنتج sku',
    'الكمية',
    'الوزن',
    'وحدة الوزن',
    'هل يتطلب شحن؟',
    'حالة المنتج',
    'الماركة',
    'خاضع للضريبة ؟',
  ];

  it('maps an Arabic simple product, keeping Arabic text and exact money', () => {
    const result = salla([
      ARABIC_HEADER,
      [
        'منتج',
        'باقة ورد جوري',
        'ورد',
        'https://cdn.salla.test/a.jpg',
        '<p>ورد طازج</p>',
        '١٥٠٫٥٠٥',
        '١٢٠',
        '60.25',
        'ROSE-1',
        '12',
        '500',
        'جم',
        'نعم',
        'ظاهر',
        'بوكيه',
        'نعم',
      ],
    ]);
    expect(result.rowIssues).toEqual([]);
    const [p] = result.products;
    expect(p.errors).toEqual([]);
    expect(p.title).toBe('باقة ورد جوري');
    expect(p.handle).toBe('باقة-ورد-جوري');
    expect(p.bodyHtml).toBe('<p>ورد طازج</p>');
    expect(p.vendor).toBe('بوكيه');
    expect(p.status).toBe('Available');
    expect(p.optionNames).toEqual([]);
    const v = p.variants[0];
    // sale price below price: sale becomes the price, the old price the compare-at
    expect(v.price).toBe('120');
    expect(v.compareAtPrice).toBe('150.505');
    expect(v.cost).toBe('60.25');
    expect(v.sku).toBe('ROSE-1');
    expect(v.tracked).toBe(true);
    expect(v.quantity).toBe(12);
    expect(v.weightKg).toBe('0.5');
    expect(v.requiresShipping).toBe(true);
    expect(v.taxable).toBe(true);
    expect(p.images.map((i) => i.url)).toEqual([
      'https://cdn.salla.test/a.jpg',
    ]);
  });

  it('ignores a sale price that is not lower, and a zero sale price', () => {
    const header = ['اسم المنتج', 'سعر المنتج', 'السعر المخفض'];
    const high = salla([
      header,
      ['A', '10', '12'],
      ['B', '10', '0'],
      ['C', '10', ''],
    ]);
    expect(
      high.products.map((p) => [
        p.variants[0].price,
        p.variants[0].compareAtPrice,
      ]),
    ).toEqual([
      ['10', null],
      ['10', null],
      ['10', null],
    ]);
    expect(high.products[0].warnings.join(' ')).toMatch(/not lower/);
    expect(high.products[1].warnings).toEqual([]);
  });

  it('matches headers tolerantly (BOM, case, brackets, English)', () => {
    const result = salla([
      [
        '\ufeffProduct Name',
        ' PRICE ',
        'Sku',
        'Quantity',
        'Weight',
        'Weight Unit',
      ],
      ['Rose', '10.505', 'R1', '3', '1.5', 'KG'],
    ]);
    const v = result.products[0].variants[0];
    expect(v.price).toBe('10.505');
    expect(v.sku).toBe('R1');
    expect(v.weightKg).toBe('1.5');
  });

  it('refuses a file without the required columns and names them', () => {
    const t = table([
      ['Sku', 'Quantity'],
      ['A', '1'],
    ]);
    let error: PlatformColumnsError | undefined;
    try {
      mapPlatformRows(SALLA_SPEC, t.rows, t.headers);
    } catch (e) {
      error = e as PlatformColumnsError;
    }
    expect(error).toBeInstanceOf(PlatformColumnsError);
    expect(error!.missing.map((m) => m.field)).toEqual(['name', 'price']);
    expect(error!.message).toMatch(/Missing columns/);
    expect(error!.message).toMatch(/Salla/);
  });

  it('maps variants from rows with no product name', () => {
    const result = salla([
      [
        'اسم المنتج',
        'سعر المنتج',
        'رمز المنتج sku',
        'الكمية',
        'أسم الخيار[1]',
        'قيمة الخيار[1]',
        'أسم الخيار[2]',
        'قيمة الخيار[2]',
      ],
      ['قميص', '100', '', '', 'المقاس', '', 'اللون', ''],
      ['', '100', 'S-RED', '4', 'المقاس', 'S', 'اللون', 'أحمر'],
      ['', '110.5', 'M-RED', '', '', 'M', '', 'أحمر'],
    ]);
    const [p] = result.products;
    expect(p.errors).toEqual([]);
    expect(p.optionNames).toEqual(['المقاس', 'اللون']);
    // The product's own row is only a parent: it is not a variant.
    expect(
      p.variants.map((v) => [
        v.sku,
        v.optionValues,
        v.price,
        v.quantity,
        v.tracked,
      ]),
    ).toEqual([
      ['S-RED', ['S', 'أحمر'], '100', 4, true],
      ['M-RED', ['M', 'أحمر'], '110.5', null, false],
    ]);
  });

  it('lets the first row carry the first variant, and a variant inherit the product price', () => {
    const result = salla([
      ['name', 'price', 'sku', 'option 1 name', 'option 1 value'],
      ['Shirt', '100', 'S', 'Size', 'S'],
      ['', '', 'M', '', 'M'],
    ]);
    const [p] = result.products;
    expect(p.errors).toEqual([]);
    expect(p.variants.map((v) => [v.sku, v.price, v.optionValues])).toEqual([
      ['S', '100', ['S']],
      ['M', '100', ['M']],
    ]);
  });

  it('flags duplicate option combinations and a missing option value', () => {
    const result = salla([
      ['name', 'price', 'sku', 'option 1 name', 'option 1 value'],
      ['Shirt', '100', 'S', 'Size', 'S'],
      ['', '100', 'S2', '', 'S'],
      ['', '100', 'S3', '', ''],
    ]);
    const errors = result.products[0].errors.join(' | ');
    expect(errors).toMatch(
      /Row 3: another variant already has these option values/,
    );
    expect(result.products[0].errors.length).toBeGreaterThan(0);
  });

  it('rejects a price that is not a plain decimal, naming the row but not guessing', () => {
    const result = salla([
      ['name', 'price'],
      ['A', '150 SAR'],
      ['B', '12,5'],
      ['C', '1e3'],
      ['D', '-5'],
    ]);
    for (const p of result.products) {
      expect(p.errors.join(' ')).toMatch(
        /Price .* is not a plain decimal number/,
      );
    }
  });

  it('requires a price per product, and skips a row with no product above it', () => {
    const result = salla([
      ['name', 'price'],
      ['', '5'],
      ['A', ''],
    ]);
    expect(result.products).toHaveLength(1);
    expect(result.products[0].errors).toContain('Row 3: Price is required');
    expect(result.rowIssues).toHaveLength(1);
    expect(result.rowIssues[0].rowNumber).toBe(2);
    expect(result.rowIssues[0].message).toMatch(/no product name/);
  });

  it('handles weight units and refuses to guess a missing one', () => {
    const result = salla([
      ['name', 'price', 'weight', 'weight unit'],
      ['A', '1', '1250', 'g'],
      ['B', '1', '2', 'kg'],
      ['C', '1', '3', 'lb'],
      ['D', '1', '', ''],
    ]);
    expect(result.products.map((p) => p.variants[0].weightKg)).toEqual([
      '1.25',
      '2',
      null,
      null,
    ]);
    expect(result.products[2].warnings.join(' ')).toMatch(/not kg or g/);
    const noUnit = salla([
      ['name', 'price', 'weight'],
      ['A', '1', '5'],
    ]);
    expect(noUnit.products[0].variants[0].weightKg).toBeNull();
    expect(noUnit.products[0].warnings.join(' ')).toMatch(/no weight unit/);
  });

  it('maps statuses and errors on an unknown one', () => {
    const result = salla([
      ['name', 'price', 'status'],
      ['A', '1', 'ظاهر'],
      ['B', '1', 'مخفي'],
      ['C', '1', 'hidden'],
      ['D', '1', 'مؤرشف'],
      ['E', '1', 'banana'],
      ['F', '1', ''],
    ]);
    expect(result.products.map((p) => p.status)).toEqual([
      'Available',
      'Unavailable',
      'Unavailable',
      'Archived',
      'Unavailable',
      'Available',
    ]);
    expect(result.products[4].errors.join(' ')).toMatch(
      /Unknown product status/,
    );
  });

  it('treats blank and unlimited quantity as untracked, and rejects text', () => {
    const result = salla([
      ['name', 'price', 'quantity'],
      ['A', '1', ''],
      ['B', '1', 'غير محدود'],
      ['C', '1', '5'],
      ['D', '1', '٧'],
      ['E', '1', 'many'],
    ]);
    expect(
      result.products.map((p) => [
        p.variants[0].tracked,
        p.variants[0].quantity,
      ]),
    ).toEqual([
      [false, null],
      [false, null],
      [true, 5],
      [true, 7],
      [false, null],
    ]);
    expect(result.products[4].errors.join(' ')).toMatch(/not a whole number/);
  });

  it('collects several images, skips invalid ones, dedupes', () => {
    const result = salla([
      ['name', 'price', 'images'],
      [
        'A',
        '1',
        'https://cdn.test/1.jpg, https://cdn.test/2.jpg ftp://x/3.jpg https://cdn.test/1.jpg',
      ],
      ['', '', 'https://cdn.test/4.jpg'],
    ]);
    const [p] = result.products;
    expect(p.images.map((i) => i.url)).toEqual([
      'https://cdn.test/1.jpg',
      'https://cdn.test/2.jpg',
      'https://cdn.test/4.jpg',
    ]);
    expect(p.warnings.join(' ')).toMatch(/not an http\(s\) URL/);
  });

  it('keeps two products with the same name apart with distinct handles', () => {
    const result = salla([
      ['name', 'price', 'sku'],
      ['Rose', '1', 'A'],
      ['Rose', '2', 'B'],
    ]);
    const handles = result.products.map((p) => p.handle);
    expect(handles[0]).toBe('rose');
    expect(handles[1]).toBe('rose-b');
    expect(new Set(handles).size).toBe(2);
  });

  it('is deterministic: the same file yields the same handles', () => {
    const rows = [
      ['name', 'price'],
      ['باقة', '1'],
      ['Rose', '2'],
    ];
    expect(salla(rows).products.map((p) => p.handle)).toEqual(
      salla(rows).products.map((p) => p.handle),
    );
  });

  it('treats a spreadsheet-formula cell as plain text', () => {
    const result = salla([
      ['name', 'price', 'description'],
      ['=HYPERLINK("http://x")', '1', '+1+1'],
    ]);
    expect(result.products[0].title).toBe('=HYPERLINK("http://x")');
    expect(result.products[0].bodyHtml).toBe('+1+1');
  });

  it('reports columns with data that were not imported', () => {
    const result = salla([
      ['name', 'price', 'Loyalty Points', 'Empty'],
      ['A', '1', '50', ''],
    ]);
    expect(result.unsupportedColumns).toEqual(['Loyalty Points']);
  });

  it('truncates an over-long name with a warning', () => {
    const result = salla([
      ['name', 'price'],
      ['x'.repeat(250), '1'],
    ]);
    expect(result.products[0].title).toHaveLength(191);
    expect(result.products[0].warnings.join(' ')).toMatch(/shortened/);
  });
});

describe('Zid mapper', () => {
  it('takes the English name and warns when the Arabic one differs', () => {
    const result = zid([
      ['name_en', 'name_ar', 'price', 'sku', 'quantity'],
      ['Rose Bouquet', 'باقة ورد', '99.5', 'Z1', '4'],
    ]);
    const [p] = result.products;
    expect(p.title).toBe('Rose Bouquet');
    expect(p.warnings.join(' ')).toMatch(/two languages/);
    expect(p.variants[0].price).toBe('99.5');
  });

  it('imports a file that only has an Arabic name', () => {
    const result = zid([
      ['اسم المنتج', 'price'],
      ['باقة ورد', '99'],
    ]);
    expect(result.products[0].title).toBe('باقة ورد');
    expect(result.products[0].warnings).toEqual([]);
    expect(result.products[0].errors).toEqual([]);
  });

  it('refuses a file without name or price and says Zid', () => {
    expect(() => zid([['sku'], ['A']])).toThrow(/Zid product export/);
  });

  it('maps a variant product by option columns', () => {
    const result = zid([
      ['name', 'price', 'sku', 'quantity', 'option 1 name', 'option 1 value'],
      ['Cap', '30', 'C-R', '2', 'Colour', 'Red'],
      ['', '30', 'C-B', '3', '', 'Blue'],
    ]);
    const [p] = result.products;
    expect(p.optionNames).toEqual(['Colour']);
    expect(p.variants.map((v) => v.optionValues[0])).toEqual(['Red', 'Blue']);
  });
});
