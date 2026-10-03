// Shopify product-CSV column mapper (ONB-1). PURE: no I/O, no database. It turns
// Shopify's export format (one row per variant or per extra image, grouped by
// Handle) into one canonical ShopifyProductIn per product, which the import
// service then classifies against the shop's catalog and writes through the same
// preview/confirm pipeline the Requital CSV import uses.
//
// RULES THIS FILE HOLDS (each is pinned by shopify-import.spec.ts):
//  * Money is a decimal STRING parsed exactly. No Number(), no float, no
//    toFixed. A Shopify export has no currency column: amounts are in the shop's
//    own currency, which the service states in the report.
//  * Unknown stays NULL. A blank "Cost per item" or "Variant Compare At Price"
//    is null, never 0. A blank SEO field is null.
//  * Nothing here fetches anything. An "Image Src" is a URL string to record.
//  * Cell text is data. A cell that starts with = + - @ is just a string.

import {
  MAX_PRODUCT_OPTIONS,
  MAX_VARIANTS_PER_PRODUCT,
} from './variant-generator';

export const MAX_SHOPIFY_ROWS = 10_000;
export const MAX_BODY_HTML_LENGTH = 200_000;
const NAME_MAX = 191;

export type ShopifyStatus = 'Available' | 'Unavailable' | 'Archived';

export interface ShopifyVariantIn {
  rowNumber: number;
  optionValues: string[];
  sku: string | null;
  barcode: string | null;
  // Exact decimal strings, or null when the cell was blank.
  price: string | null;
  compareAtPrice: string | null;
  cost: string | null;
  // Kilograms as an exact decimal string, converted from Shopify's grams.
  weightKg: string | null;
  tracked: boolean;
  continueSelling: boolean;
  // Absolute quantity, or null when not tracked or blank.
  quantity: number | null;
  requiresShipping: boolean | null;
  taxable: boolean | null;
  imageUrl: string | null;
}

export interface ShopifyImageIn {
  url: string;
  position: number;
  rowNumber: number;
}

export interface ShopifyProductIn {
  handle: string;
  rowNumber: number;
  title: string;
  bodyHtml: string | null;
  vendor: string | null;
  productType: string | null;
  category: string | null;
  tags: string[];
  status: ShopifyStatus;
  seoTitle: string | null;
  seoDescription: string | null;
  optionNames: string[];
  variants: ShopifyVariantIn[];
  images: ShopifyImageIn[];
  errors: string[];
  warnings: string[];
}

export interface ShopifyRowIssue {
  rowNumber: number;
  message: string;
}

export interface ShopifyMapResult {
  products: ShopifyProductIn[];
  rowIssues: ShopifyRowIssue[];
  // Columns that hold data in this file but that Requital does not import.
  unsupportedColumns: string[];
  warnings: string[];
}

// Columns this mapper reads. Anything else with data in it is reported as
// unsupported rather than silently dropped.
const READ_COLUMNS = new Set([
  'Handle',
  'Title',
  'Body (HTML)',
  'Vendor',
  'Product Category',
  'Type',
  'Tags',
  'Published',
  'Option1 Name',
  'Option1 Value',
  'Option2 Name',
  'Option2 Value',
  'Option3 Name',
  'Option3 Value',
  'Variant SKU',
  'Variant Grams',
  'Variant Inventory Tracker',
  'Variant Inventory Qty',
  'Variant Inventory Policy',
  'Variant Price',
  'Variant Compare At Price',
  'Variant Requires Shipping',
  'Variant Taxable',
  'Variant Barcode',
  'Barcode',
  'Image Src',
  'Image Position',
  'Image Alt Text',
  'Variant Image',
  'SEO Title',
  'SEO Description',
  'Status',
  'Cost per item',
  // Read but carries nothing we need: Variant Grams is always grams whatever the
  // display unit, and the fulfilment service is almost always "manual".
  'Variant Weight Unit',
  'Variant Fulfillment Service',
  'Gift Card',
]);

// Read but deliberately not imported, with the reason shown to the merchant.
const IGNORED_WITH_REASON: Record<string, string> = {
  'Image Alt Text':
    'Image alt text is not stored by Requital, so it was not imported.',
};

const HANDLE_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u;

// ----- exact decimal helpers (no floats anywhere) -----

const DECIMAL_PATTERN = /^\d{1,12}(\.\d{1,8})?$/;

// A plain non-negative decimal, kept as the exact string the merchant exported.
export function parseDecimalString(raw: string | undefined): {
  value: string | null;
  error?: string;
} {
  const text = (raw ?? '').trim();
  if (!text) return { value: null };
  if (!DECIMAL_PATTERN.test(text)) {
    return {
      value: null,
      error: `"${text.slice(0, 40)}" is not a plain decimal number`,
    };
  }
  return { value: text };
}

// Equality of two decimal strings ignoring leading/trailing zeros, with no
// floating point involved. Used to decide whether an update changes a price.
export function decimalEquals(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return normalizeDecimal(a) === normalizeDecimal(b);
}

export function normalizeDecimal(value: string): string {
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [intPart, fracPart = ''] = unsigned.split('.');
  const int = intPart.replace(/^0+(?=\d)/, '') || '0';
  const frac = fracPart.replace(/0+$/, '');
  const text = frac ? `${int}.${frac}` : int;
  return negative && text !== '0' ? `-${text}` : text;
}

// grams -> kilograms by moving the decimal point three places, as strings.
export function gramsToKilograms(grams: string): string {
  const [intPart, fracPart = ''] = grams.split('.');
  const padded = intPart.padStart(4, '0');
  const kgInt = padded.slice(0, -3);
  const kgFrac = padded.slice(-3) + fracPart;
  return normalizeDecimal(`${kgInt}.${kgFrac}`);
}

function parseBoolean(raw: string | undefined): boolean | null {
  const v = (raw ?? '').trim().toLowerCase();
  if (['true', 'yes', '1'].includes(v)) return true;
  if (['false', 'no', '0'].includes(v)) return false;
  return null;
}

function clean(raw: string | undefined): string | null {
  const v = (raw ?? '').trim();
  return v ? v : null;
}

function truncated(
  value: string | null,
  max: number,
  label: string,
  warnings: string[],
): string | null {
  if (value !== null && value.length > max) {
    warnings.push(
      `${label} was longer than ${max} characters and was shortened`,
    );
    return value.slice(0, max);
  }
  return value;
}

function validImageUrl(raw: string): { url?: string; reason?: string } {
  const url = raw.trim();
  // eslint-disable-next-line no-control-regex -- control characters are refused on purpose
  if (/[\x00-\x20\x7f\\]/.test(url))
    return { reason: 'contains a space or control character' };
  if (!/^https?:\/\//i.test(url)) return { reason: 'is not an http(s) URL' };
  if (url.length > NAME_MAX) {
    return {
      reason: `is longer than ${NAME_MAX} characters, the most Requital can store`,
    };
  }
  try {
    new URL(url);
  } catch {
    return { reason: 'is not a valid URL' };
  }
  return { url };
}

function mapStatus(
  rawStatus: string | undefined,
  rawPublished: string | undefined,
  errors: string[],
): ShopifyStatus {
  const status = (rawStatus ?? '').trim().toLowerCase();
  const published = parseBoolean(rawPublished);
  if (status === 'archived') return 'Archived';
  if (status === 'draft') return 'Unavailable';
  if (status === 'active' || status === '') {
    // "Published" is Shopify's online-store channel switch: an active product
    // that is not published there is not for sale on the storefront.
    if (published === false) return 'Unavailable';
    return 'Available';
  }
  errors.push(
    `Unknown Status "${status.slice(0, 30)}" (expected active, draft or archived)`,
  );
  return 'Unavailable';
}

function isVariantRow(row: Record<string, string>): boolean {
  return [
    'Option1 Value',
    'Variant SKU',
    'Variant Price',
    'Variant Compare At Price',
    'Variant Grams',
    'Variant Inventory Qty',
    'Variant Barcode',
    'Cost per item',
  ].some((c) => (row[c] ?? '').trim() !== '');
}

function parseVariant(
  row: Record<string, string>,
  rowNumber: number,
  optionCount: number,
  errors: string[],
): ShopifyVariantIn {
  const where = `Row ${rowNumber}`;
  const price = parseDecimalString(row['Variant Price']);
  if (price.error) errors.push(`${where}: Variant Price ${price.error}`);
  const compare = parseDecimalString(row['Variant Compare At Price']);
  if (compare.error)
    errors.push(`${where}: Variant Compare At Price ${compare.error}`);
  const cost = parseDecimalString(row['Cost per item']);
  if (cost.error) errors.push(`${where}: Cost per item ${cost.error}`);
  const grams = parseDecimalString(row['Variant Grams']);
  if (grams.error) errors.push(`${where}: Variant Grams ${grams.error}`);

  const tracker = (row['Variant Inventory Tracker'] ?? '').trim();
  const tracked = tracker !== '';
  const qtyRaw = (row['Variant Inventory Qty'] ?? '').trim();
  let quantity: number | null = null;
  if (qtyRaw) {
    if (!/^-?\d{1,9}$/.test(qtyRaw)) {
      errors.push(
        `${where}: Variant Inventory Qty "${qtyRaw.slice(0, 20)}" is not a whole number`,
      );
    } else if (tracked) {
      quantity = Number(qtyRaw);
    }
  }

  const optionValues: string[] = [];
  for (let n = 1; n <= optionCount; n += 1) {
    const value = (row[`Option${n} Value`] ?? '').trim();
    if (!value) errors.push(`${where}: Option${n} Value is required`);
    if (value.length > NAME_MAX)
      errors.push(
        `${where}: Option${n} Value is longer than ${NAME_MAX} characters`,
      );
    optionValues.push(value);
  }

  const sku = clean(row['Variant SKU']);
  if (sku && sku.length > NAME_MAX)
    errors.push(`${where}: Variant SKU is longer than ${NAME_MAX} characters`);
  const barcode = clean(row['Variant Barcode']) ?? clean(row['Barcode']);
  if (barcode && barcode.length > NAME_MAX) {
    errors.push(
      `${where}: Variant Barcode is longer than ${NAME_MAX} characters`,
    );
  }

  const policy = (row['Variant Inventory Policy'] ?? '').trim().toLowerCase();
  return {
    rowNumber,
    optionValues,
    sku,
    barcode,
    price: price.value,
    compareAtPrice: compare.value,
    cost: cost.value,
    weightKg: grams.value === null ? null : gramsToKilograms(grams.value),
    tracked,
    continueSelling: policy === 'continue',
    quantity,
    requiresShipping: parseBoolean(row['Variant Requires Shipping']),
    taxable: parseBoolean(row['Variant Taxable']),
    imageUrl: clean(row['Variant Image']),
  };
}

export function mapShopifyRows(
  rows: Record<string, string>[],
  headers: string[],
): ShopifyMapResult {
  const rowIssues: ShopifyRowIssue[] = [];
  const warnings: string[] = [];
  const groups = new Map<
    string,
    { rowNumber: number; row: Record<string, string> }[]
  >();
  let previousHandle: string | null = null;
  const nonContiguous = new Set<string>();

  rows.forEach((row, index) => {
    const rowNumber = index + 2; // header is row 1
    const handle = (row['Handle'] ?? '').trim();
    if (!handle) {
      rowIssues.push({
        rowNumber,
        message: 'Row has no Handle and was skipped',
      });
      return;
    }
    if (
      previousHandle !== null &&
      handle !== previousHandle &&
      groups.has(handle)
    ) {
      nonContiguous.add(handle);
    }
    previousHandle = handle;
    const list = groups.get(handle) ?? [];
    list.push({ rowNumber, row });
    groups.set(handle, list);
  });
  for (const handle of nonContiguous) {
    warnings.push(
      `Rows for the handle "${handle.slice(0, 60)}" are not next to each other in the file. They were merged into one product.`,
    );
  }

  const unsupported = new Set<string>();
  for (const header of headers) {
    if (READ_COLUMNS.has(header) || header === '') continue;
    if (rows.some((r) => (r[header] ?? '').trim() !== ''))
      unsupported.add(header);
  }
  for (const [column, reason] of Object.entries(IGNORED_WITH_REASON)) {
    if (rows.some((r) => (r[column] ?? '').trim() !== ''))
      warnings.push(reason);
  }

  const products: ShopifyProductIn[] = [];
  for (const [handle, list] of groups) {
    const errors: string[] = [];
    const productWarnings: string[] = [];
    const first = list[0];
    const head = first.row;

    if (handle !== handle.toLowerCase()) {
      errors.push('Handle must be lowercase');
    } else if (handle.length > NAME_MAX || !HANDLE_PATTERN.test(handle)) {
      errors.push(
        'Handle may only contain letters, digits, hyphens and underscores',
      );
    }

    const title = truncated(
      clean(head['Title']),
      NAME_MAX,
      'Title',
      productWarnings,
    );
    if (!title) errors.push('Title is required');

    if (parseBoolean(head['Gift Card']) === true) {
      errors.push(
        'Gift cards cannot be imported (they need denominations); create it in Requital',
      );
    }

    const bodyHtml = clean(head['Body (HTML)']);
    if (bodyHtml && bodyHtml.length > MAX_BODY_HTML_LENGTH) {
      errors.push(
        `Body (HTML) is longer than ${MAX_BODY_HTML_LENGTH} characters`,
      );
    }

    // Options come from the first row's names. A product with no real options
    // has the single option Title = "Default Title".
    const rawOptionNames = [1, 2, 3].map((n) =>
      (head[`Option${n} Name`] ?? '').trim(),
    );
    let optionNames = rawOptionNames.filter((n) => n !== '');
    if (optionNames.length > MAX_PRODUCT_OPTIONS) {
      errors.push(`A product can have at most ${MAX_PRODUCT_OPTIONS} options`);
    }
    for (const name of optionNames) {
      if (name.length > NAME_MAX)
        errors.push(`Option name is longer than ${NAME_MAX} characters`);
    }

    const variantRows = list.filter(
      (entry, i) => i === 0 || isVariantRow(entry.row),
    );
    const isDefaultTitle =
      optionNames.length === 1 &&
      optionNames[0].toLowerCase() === 'title' &&
      variantRows.length === 1 &&
      (variantRows[0].row['Option1 Value'] ?? '').trim().toLowerCase() ===
        'default title';
    if (
      isDefaultTitle ||
      (optionNames.length === 0 && variantRows.length === 1)
    ) {
      optionNames = [];
    } else if (optionNames.length === 0) {
      errors.push('Several variants need Option1 Name');
    }

    if (variantRows.length > MAX_VARIANTS_PER_PRODUCT) {
      errors.push(
        `A product can have at most ${MAX_VARIANTS_PER_PRODUCT} variants (this one has ${variantRows.length})`,
      );
    }

    const variants: ShopifyVariantIn[] = variantRows.map((entry) =>
      parseVariant(entry.row, entry.rowNumber, optionNames.length, errors),
    );

    const seenCombos = new Set<string>();
    for (const v of variants) {
      if (optionNames.length === 0) continue;
      const key = JSON.stringify(v.optionValues.map((x) => x.toLowerCase()));
      if (seenCombos.has(key)) {
        errors.push(
          `Row ${v.rowNumber}: another variant already has these option values`,
        );
      }
      seenCombos.add(key);
    }
    if (variants.length > 0 && variants[0].price === null) {
      errors.push(`Row ${variants[0].rowNumber}: Variant Price is required`);
    }
    for (const v of variants.slice(1)) {
      if (v.price === null)
        errors.push(`Row ${v.rowNumber}: Variant Price is required`);
    }

    const trackedValues = new Set(variants.map((v) => v.tracked));
    if (trackedValues.size > 1) {
      productWarnings.push(
        "Inventory tracking is per product in Requital; the first variant's setting was used for all of them",
      );
    }

    const images: ShopifyImageIn[] = [];
    const seenUrls = new Set<string>();
    let appended = 0;
    for (const entry of list) {
      const raw = (entry.row['Image Src'] ?? '').trim();
      if (!raw) continue;
      const checked = validImageUrl(raw);
      if (!checked.url) {
        productWarnings.push(
          `Row ${entry.rowNumber}: image URL ${checked.reason}, so it was skipped`,
        );
        continue;
      }
      if (seenUrls.has(checked.url)) continue;
      seenUrls.add(checked.url);
      const positionRaw = (entry.row['Image Position'] ?? '').trim();
      const position = /^\d{1,6}$/.test(positionRaw)
        ? Number(positionRaw)
        : 1_000_000 + (appended += 1);
      images.push({ url: checked.url, position, rowNumber: entry.rowNumber });
    }
    images.sort((a, b) => a.position - b.position || a.rowNumber - b.rowNumber);

    for (const v of variants) {
      if (v.imageUrl === null) continue;
      const checked = validImageUrl(v.imageUrl);
      if (!checked.url) {
        productWarnings.push(
          `Row ${v.rowNumber}: variant image URL ${checked.reason}, so it was skipped`,
        );
        v.imageUrl = null;
        continue;
      }
      v.imageUrl = checked.url;
      if (!seenUrls.has(checked.url)) {
        seenUrls.add(checked.url);
        images.push({
          url: checked.url,
          position: 2_000_000 + images.length,
          rowNumber: v.rowNumber,
        });
      }
    }

    const tags: string[] = [];
    const seenTags = new Set<string>();
    for (const part of (head['Tags'] ?? '').split(',')) {
      const tag = part.trim();
      if (!tag) continue;
      if (tag.length > NAME_MAX) {
        productWarnings.push(
          `A tag longer than ${NAME_MAX} characters was skipped`,
        );
        continue;
      }
      if (!seenTags.has(tag.toLowerCase())) {
        seenTags.add(tag.toLowerCase());
        tags.push(tag);
      }
    }

    products.push({
      handle,
      rowNumber: first.rowNumber,
      title: title ?? '',
      bodyHtml,
      vendor: truncated(
        clean(head['Vendor']),
        NAME_MAX,
        'Vendor',
        productWarnings,
      ),
      productType: truncated(
        clean(head['Type']),
        NAME_MAX,
        'Type',
        productWarnings,
      ),
      category: clean(head['Product Category']),
      tags,
      status: mapStatus(head['Status'], head['Published'], errors),
      seoTitle: truncated(
        clean(head['SEO Title']),
        NAME_MAX,
        'SEO Title',
        productWarnings,
      ),
      seoDescription: clean(head['SEO Description']),
      optionNames,
      variants,
      images,
      errors,
      warnings: productWarnings,
    });
  }

  return {
    products,
    rowIssues,
    unsupportedColumns: [...unsupported].sort(),
    warnings,
  };
}

// True when the header row looks like a Shopify product export. Deliberately
// permissive about extra columns, strict about the ones that identify the format.
export function looksLikeShopifyExport(headers: string[]): boolean {
  const set = new Set(headers);
  return (
    set.has('Handle') &&
    (set.has('Title') || set.has('Variant Price') || set.has('Body (HTML)'))
  );
}
