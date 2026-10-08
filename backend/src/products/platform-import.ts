// Table-driven product-export mapper shared by the Salla and Zid importers
// (ONB-2). PURE: no I/O, no database. A platform is described by a PlatformSpec
// (salla-import.ts, zid-import.ts: header aliases, status words, yes/no words,
// weight units). This engine turns the spec plus the rows of an export into the
// same canonical ShopifyProductIn the Shopify mapper produces, so the existing
// classifier and writer (ProductShopifyImportService) run unchanged.
//
// RULES THIS FILE HOLDS (pinned by platform-import.spec.ts):
//  * Header matching is tolerant: trimmed, case-insensitive, BOM and zero-width
//    and bidi marks removed, Arabic diacritics and tatweel dropped, alef and
//    yeh variants folded, separators and brackets treated as spaces. A column is
//    found by ANY of its aliases; the first alias listed wins.
//  * Required columns missing => PlatformColumnsError (the service answers 400
//    naming them). Nothing is guessed.
//  * Money is a decimal STRING parsed exactly (Arabic-Indic digits and the
//    Arabic decimal mark are transliterated as text). No Number(), no float, no
//    toFixed. A sale price below the price becomes price + compare-at; the
//    comparison is done on strings.
//  * Unknown stays NULL: a blank cost, compare-at, barcode, weight is null.
//  * Nothing here fetches anything. An image cell is URL text to record.
//  * Cell text is data. A cell starting with = + - @ is just a string.

import { createHash } from 'crypto';
import {
  MAX_BODY_HTML_LENGTH,
  NAME_MAX,
  gramsToKilograms,
  normalizeDecimal,
  parseDecimalString,
  validImageUrl,
  type ShopifyImageIn,
  type ShopifyMapResult,
  type ShopifyProductIn,
  type ShopifyRowIssue,
  type ShopifyStatus,
  type ShopifyVariantIn,
} from './shopify-import';
import { MAX_VARIANTS_PER_PRODUCT } from './variant-generator';

export type PlatformSource = 'salla' | 'zid';

export type PlatformField =
  | 'handle'
  | 'name'
  | 'nameAlt'
  | 'rowType'
  | 'description'
  | 'category'
  | 'vendor'
  | 'productType'
  | 'tags'
  | 'status'
  | 'price'
  | 'salePrice'
  | 'compareAtPrice'
  | 'cost'
  | 'sku'
  | 'barcode'
  | 'quantity'
  | 'weight'
  | 'weightUnit'
  | 'requiresShipping'
  | 'taxable'
  | 'images'
  | 'variantImage'
  | 'seoTitle'
  | 'seoDescription'
  | 'option1Name'
  | 'option2Name'
  | 'option3Name'
  | 'option1Value'
  | 'option2Value'
  | 'option3Value';

export interface PlatformSpec {
  source: PlatformSource;
  label: string;
  // Header aliases per field, most likely first. Compared after normaliseHeader.
  aliases: Partial<Record<PlatformField, string[]>>;
  // Fields without which the file is refused.
  required: PlatformField[];
  // Status words (normalised on compare). Unknown words are a row error.
  statuses: { available: string[]; unavailable: string[]; archived: string[] };
  yes: string[];
  no: string[];
  // Quantity cells that mean "not tracked".
  unlimitedQuantity: string[];
  weightUnits: { kg: string[]; g: string[] };
  // A rowType cell with one of these words always marks a variant/option row.
  variantRowTypes: string[];
}

export class PlatformColumnsError extends Error {
  constructor(
    readonly label: string,
    readonly missing: { field: PlatformField; expected: string[] }[],
  ) {
    super(
      `This does not look like a ${label} product export. Missing columns: ${missing
        .map((m) => `${m.field} (${m.expected.slice(0, 4).join(' / ')})`)
        .join('; ')}`,
    );
  }
}

export const MAX_PLATFORM_ROWS = 10_000;

// ----------------------------------------------------------------- text helpers

export function normaliseHeader(raw: string): string {
  return (
    raw
      .normalize('NFKC')
      // zero-width, bidi marks, BOM
      .replace(/[​-‏‪-‮⁦-⁩﻿]/g, '')
      // Arabic diacritics and tatweel
      .replace(/[ً-ٰٟـ]/g, '')
      .replace(/[أإآٱ]/g, 'ا')
      .replace(/ى/g, 'ي')
      .toLowerCase()
      .replace(/[[\](){}_\-:*?؟،,./\\|]+/g, ' ')
      // option1 -> option 1, sku2 -> sku 2
      .replace(/(\p{L})(\d)/gu, '$1 $2')
      .replace(/(\d)(\p{L})/gu, '$1 $2')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

// Arabic-Indic and Persian digits, the Arabic decimal mark, and a thousands
// separator when (and only when) it is unambiguous. Pure text, exact.
export function toAsciiNumber(raw: string): string {
  let text = raw
    .normalize('NFKC')
    .replace(/[​-‏‪-‮﻿]/g, '')
    .trim()
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, '.')
    .replace(/٬/g, ',');
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(text)) text = text.replace(/,/g, '');
  return text;
}

// Exact comparison of two plain non-negative decimal strings: -1, 0 or 1.
export function compareDecimal(a: string, b: string): number {
  const [ai, af = ''] = normalizeDecimal(a).split('.');
  const [bi, bf = ''] = normalizeDecimal(b).split('.');
  if (ai.length !== bi.length) return ai.length < bi.length ? -1 : 1;
  if (ai !== bi) return ai < bi ? -1 : 1;
  const width = Math.max(af.length, bf.length);
  const fa = af.padEnd(width, '0');
  const fb = bf.padEnd(width, '0');
  if (fa === fb) return 0;
  return fa < fb ? -1 : 1;
}

// A URL-safe, lower-case handle that keeps non-Latin letters (an Arabic
// product keeps an Arabic handle). Deterministic, so re-importing the same file
// matches the product created the first time.
export function deriveHandle(name: string): string {
  const base = name
    .normalize('NFKC')
    .replace(/[ً-ٰٟـ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
    .replace(/-+$/g, '');
  if (base) return base;
  return `product-${createHash('sha1').update(name).digest('hex').slice(0, 8)}`;
}

function wordSet(words: string[]): Set<string> {
  return new Set(words.map(normaliseHeader));
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

// ------------------------------------------------------------------ columns

interface Columns {
  has: (field: PlatformField) => boolean;
  get: (row: Record<string, string>, field: PlatformField) => string;
  used: Set<string>;
}

export function resolveColumns(spec: PlatformSpec, headers: string[]): Columns {
  const byNormal = new Map<string, string>();
  for (const header of headers) {
    const key = normaliseHeader(header);
    if (key && !byNormal.has(key)) byNormal.set(key, header);
  }
  const chosen = new Map<PlatformField, string[]>();
  const used = new Set<string>();
  const missing: { field: PlatformField; expected: string[] }[] = [];
  for (const [field, aliases] of Object.entries(spec.aliases) as [
    PlatformField,
    string[],
  ][]) {
    // Every matching alias contributes a column, in alias order: a file can
    // carry the same field twice (for example an Arabic and an English name).
    const found: string[] = [];
    for (const alias of aliases) {
      const header = byNormal.get(normaliseHeader(alias));
      if (header !== undefined && !found.includes(header)) found.push(header);
    }
    if (found.length > 0) {
      chosen.set(field, found);
      found.forEach((h) => used.add(h));
    }
  }
  for (const field of spec.required) {
    // A name written in only one language may sit in the second name column.
    if (chosen.has(field) || (field === 'name' && chosen.has('nameAlt')))
      continue;
    missing.push({ field, expected: spec.aliases[field] ?? [] });
  }
  if (missing.length > 0) throw new PlatformColumnsError(spec.label, missing);
  return {
    has: (field) => chosen.has(field),
    // First non-empty cell among the field's columns.
    get: (row, field) => {
      for (const header of chosen.get(field) ?? []) {
        const v = (row[header] ?? '').trim();
        if (v !== '') return v;
      }
      return '';
    },
    used,
  };
}

// --------------------------------------------------------------------- mapper

type Entry = { rowNumber: number; row: Record<string, string> };

export function mapPlatformRows(
  spec: PlatformSpec,
  rows: Record<string, string>[],
  headers: string[],
): ShopifyMapResult {
  const cols = resolveColumns(spec, headers);
  const yes = wordSet(spec.yes);
  const no = wordSet(spec.no);
  const unlimited = wordSet(spec.unlimitedQuantity);
  const variantTypes = wordSet(spec.variantRowTypes);
  const kgUnits = wordSet(spec.weightUnits.kg);
  const gUnits = wordSet(spec.weightUnits.g);
  const statusAvailable = wordSet(spec.statuses.available);
  const statusUnavailable = wordSet(spec.statuses.unavailable);
  const statusArchived = wordSet(spec.statuses.archived);

  const rowIssues: ShopifyRowIssue[] = [];
  const warnings: string[] = [];

  const nameOf = (row: Record<string, string>) =>
    cols.get(row, 'name') || cols.get(row, 'nameAlt');
  const optionValuesOf = (row: Record<string, string>) =>
    ([1, 2, 3] as const).map((n) =>
      cols.get(row, `option${n}Value` as PlatformField),
    );
  const hasOptionValue = (row: Record<string, string>) =>
    optionValuesOf(row).some((v) => v !== '');

  // ---- group rows into products (a product starts at a row with a name) ----
  const groups: Entry[][] = [];
  let current: Entry[] | null = null;
  let currentName = '';
  rows.forEach((row, index) => {
    const rowNumber = index + 2; // header is row 1
    const name = nameOf(row);
    const typeWord = normaliseHeader(cols.get(row, 'rowType'));
    const forcedVariant = typeWord !== '' && variantTypes.has(typeWord);
    const startsProduct =
      name !== '' &&
      !forcedVariant &&
      // The same name again with option values is another variant of the
      // product above, not a new product.
      !(current !== null && name === currentName && hasOptionValue(row));
    if (startsProduct) {
      current = [{ rowNumber, row }];
      currentName = name;
      groups.push(current);
      return;
    }
    if (current === null) {
      rowIssues.push({
        rowNumber,
        message:
          'Row has no product name and no product above it, so it was skipped',
      });
      return;
    }
    current.push({ rowNumber, row });
  });

  // ---- cell parsers ----
  const bool = (raw: string): boolean | null => {
    const v = normaliseHeader(raw);
    if (v === '') return null;
    if (yes.has(v)) return true;
    if (no.has(v)) return false;
    return null;
  };
  const money = (
    row: Record<string, string>,
    field: PlatformField,
    label: string,
    where: string,
    errors: string[],
  ): string | null => {
    const raw = cols.get(row, field);
    if (raw === '') return null;
    const parsed = parseDecimalString(toAsciiNumber(raw));
    if (parsed.error) errors.push(`${where}: ${label} ${parsed.error}`);
    return parsed.value;
  };

  const products: ShopifyProductIn[] = [];
  const usedHandles = new Set<string>();

  for (const group of groups) {
    const errors: string[] = [];
    const productWarnings: string[] = [];
    const head = group[0];
    const headRow = head.row;

    const title = truncated(
      clean(cols.get(headRow, 'name')) ?? clean(cols.get(headRow, 'nameAlt')),
      NAME_MAX,
      'Product name',
      productWarnings,
    );
    if (!title) errors.push('Product name is required');
    if (
      cols.get(headRow, 'name') !== '' &&
      cols.get(headRow, 'nameAlt') !== '' &&
      cols.get(headRow, 'name') !== cols.get(headRow, 'nameAlt')
    ) {
      productWarnings.push(
        'The file has the product name in two languages. The first column was used; the other was not imported.',
      );
    }

    // ---- handle ----
    const explicit = clean(cols.get(headRow, 'handle'));
    let handle = deriveHandle(explicit ?? title ?? '');
    if (usedHandles.has(handle)) {
      const sku = clean(cols.get(headRow, 'sku'));
      const suffix = sku ? deriveHandle(sku) : String(head.rowNumber);
      let candidate = `${handle}-${suffix}`.slice(0, NAME_MAX);
      let n = 2;
      while (usedHandles.has(candidate)) {
        candidate = `${handle}-${n}`.slice(0, NAME_MAX);
        n += 1;
      }
      productWarnings.push(
        `Another product in the file has the same name, so this one's address ends in "${candidate.slice(handle.length)}"`,
      );
      handle = candidate;
    }
    usedHandles.add(handle);

    // ---- options ----
    // Slots 1..3 that have a name anywhere in the product's rows.
    const activeSlots = ([1, 2, 3] as const).filter((n) =>
      group.some(
        (e) => cols.get(e.row, `option${n}Name` as PlatformField) !== '',
      ),
    );
    let realNames = activeSlots.map(
      (n) =>
        group
          .map((e) => cols.get(e.row, `option${n}Name` as PlatformField))
          .find((v) => v !== '') ?? '',
    );
    for (const name of realNames) {
      if (name.length > NAME_MAX)
        errors.push(`Option name is longer than ${NAME_MAX} characters`);
    }

    // ---- which rows are variants ----
    const isVariantEntry = (entry: Entry) =>
      hasOptionValue(entry.row) ||
      ['sku', 'price', 'quantity', 'barcode', 'cost'].some(
        (f) => cols.get(entry.row, f as PlatformField) !== '',
      );
    const tail = group.slice(1).filter(isVariantEntry);
    // The first row is the product's own row. It is also a variant unless it
    // is only a parent above rows that carry the option values.
    const headIsVariant = hasOptionValue(headRow) || tail.length === 0;
    const variantEntries = headIsVariant ? [head, ...tail] : tail;

    const anyValues = variantEntries.some((e) => hasOptionValue(e.row));
    if (!anyValues && variantEntries.length === 1) {
      realNames = [];
    } else if (realNames.length === 0) {
      errors.push('Several variants need an option name column');
    }

    if (variantEntries.length > MAX_VARIANTS_PER_PRODUCT) {
      errors.push(
        `A product can have at most ${MAX_VARIANTS_PER_PRODUCT} variants (this one has ${variantEntries.length})`,
      );
    }

    // ---- product-level price used when a variant leaves its own blank ----
    const headPriceRaw = money(
      headRow,
      'price',
      'Price',
      `Row ${head.rowNumber}`,
      [],
    );

    const variants: ShopifyVariantIn[] = variantEntries.map((entry) => {
      const where = `Row ${entry.rowNumber}`;
      const row = entry.row;
      let price = money(row, 'price', 'Price', where, errors);
      let compareAt = money(
        row,
        'compareAtPrice',
        'Compare-at price',
        where,
        errors,
      );
      const sale = money(row, 'salePrice', 'Sale price', where, errors);
      if (price === null && entry !== head && headPriceRaw !== null) {
        price = headPriceRaw;
      }
      if (sale !== null && normalizeDecimal(sale) !== '0') {
        if (price !== null && compareDecimal(sale, price) < 0) {
          // Platforms keep the full price and a lower sale price; Requital keeps
          // the selling price and the struck-through "was" price.
          if (compareAt === null) compareAt = price;
          price = sale;
        } else {
          productWarnings.push(
            `${where}: sale price is not lower than the price, so it was ignored`,
          );
        }
      }
      const cost = money(row, 'cost', 'Cost price', where, errors);

      // Quantity: a number tracks stock, a blank or "unlimited" does not.
      const qtyRaw = toAsciiNumber(cols.get(row, 'quantity'));
      let quantity: number | null = null;
      let tracked = false;
      if (qtyRaw !== '' && !unlimited.has(normaliseHeader(qtyRaw))) {
        if (!/^\d{1,9}$/.test(qtyRaw)) {
          errors.push(
            `${where}: Quantity "${qtyRaw.slice(0, 20)}" is not a whole number`,
          );
        } else {
          tracked = true;
          quantity = Number(qtyRaw);
        }
      }

      // Weight: only imported when the unit is known. No unit column, or a unit
      // we cannot convert exactly, leaves the weight NULL.
      let weightKg: string | null = null;
      const weightRaw = money(row, 'weight', 'Weight', where, errors);
      if (weightRaw !== null && normalizeDecimal(weightRaw) !== '0') {
        const unit = normaliseHeader(cols.get(row, 'weightUnit'));
        if (unit !== '' && kgUnits.has(unit))
          weightKg = normalizeDecimal(weightRaw);
        else if (unit !== '' && gUnits.has(unit))
          weightKg = gramsToKilograms(weightRaw);
        else {
          const note =
            unit === ''
              ? 'the file has no weight unit'
              : `the weight unit "${unit.slice(0, 20)}" is not kg or g`;
          const message = `Weight was not imported because ${note}`;
          if (!productWarnings.includes(message)) productWarnings.push(message);
        }
      }

      const optionValues: string[] = [];
      activeSlots.forEach((slot, i) => {
        const value = cols.get(row, `option${slot}Value` as PlatformField);
        if (value === '')
          errors.push(`${where}: option ${i + 1} value is required`);
        if (value.length > NAME_MAX)
          errors.push(
            `${where}: option ${i + 1} value is longer than ${NAME_MAX} characters`,
          );
        optionValues.push(value);
      });

      const sku = clean(cols.get(row, 'sku'));
      if (sku && sku.length > NAME_MAX)
        errors.push(`${where}: SKU is longer than ${NAME_MAX} characters`);
      const barcode = clean(cols.get(row, 'barcode'));
      if (barcode && barcode.length > NAME_MAX)
        errors.push(`${where}: barcode is longer than ${NAME_MAX} characters`);

      return {
        rowNumber: entry.rowNumber,
        optionValues,
        sku,
        barcode,
        price,
        compareAtPrice: compareAt,
        cost,
        weightKg,
        tracked,
        continueSelling: false,
        quantity,
        requiresShipping: bool(cols.get(row, 'requiresShipping')),
        taxable: bool(cols.get(row, 'taxable')),
        imageUrl: clean(cols.get(row, 'variantImage')),
      };
    });

    const seenCombos = new Set<string>();
    for (const v of variants) {
      if (realNames.length === 0) continue;
      const key = JSON.stringify(v.optionValues.map((x) => x.toLowerCase()));
      if (seenCombos.has(key)) {
        errors.push(
          `Row ${v.rowNumber}: another variant already has these option values`,
        );
      }
      seenCombos.add(key);
    }
    for (const v of variants) {
      if (v.price === null)
        errors.push(`Row ${v.rowNumber}: Price is required`);
    }
    if (variants.length === 0) errors.push('The product has no price row');

    // ---- description / text ----
    const description = clean(cols.get(headRow, 'description'));
    if (description && description.length > MAX_BODY_HTML_LENGTH) {
      errors.push(
        `Description is longer than ${MAX_BODY_HTML_LENGTH} characters`,
      );
    }

    // ---- images: any row of the product may carry URLs ----
    const images: ShopifyImageIn[] = [];
    const seenUrls = new Set<string>();
    const addImage = (raw: string, rowNumber: number, position: number) => {
      for (const part of splitUrls(raw)) {
        const checked = validImageUrl(part);
        if (!checked.url) {
          productWarnings.push(
            `Row ${rowNumber}: image URL ${checked.reason}, so it was skipped`,
          );
          continue;
        }
        if (seenUrls.has(checked.url)) continue;
        seenUrls.add(checked.url);
        images.push({
          url: checked.url,
          position: position + images.length,
          rowNumber,
        });
      }
    };
    for (const entry of group)
      addImage(cols.get(entry.row, 'images'), entry.rowNumber, 0);
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
          position: images.length,
          rowNumber: v.rowNumber,
        });
      }
    }
    images.forEach((img, i) => (img.position = i + 1));

    // ---- tags ----
    const tags: string[] = [];
    const seenTags = new Set<string>();
    for (const part of cols.get(headRow, 'tags').split(/[,،;|]/)) {
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

    // ---- status ----
    const statusWord = normaliseHeader(cols.get(headRow, 'status'));
    let status: ShopifyStatus = 'Available';
    if (statusWord !== '') {
      if (statusAvailable.has(statusWord)) status = 'Available';
      else if (statusUnavailable.has(statusWord)) status = 'Unavailable';
      else if (statusArchived.has(statusWord)) status = 'Archived';
      else {
        errors.push(`Unknown product status "${statusWord.slice(0, 30)}"`);
        status = 'Unavailable';
      }
    }

    products.push({
      handle,
      rowNumber: head.rowNumber,
      title: title ?? '',
      bodyHtml: description,
      vendor: truncated(
        clean(cols.get(headRow, 'vendor')),
        NAME_MAX,
        'Brand',
        productWarnings,
      ),
      productType: truncated(
        clean(cols.get(headRow, 'productType')),
        NAME_MAX,
        'Product type',
        productWarnings,
      ),
      category: clean(cols.get(headRow, 'category')),
      tags,
      status,
      seoTitle: truncated(
        clean(cols.get(headRow, 'seoTitle')),
        NAME_MAX,
        'SEO title',
        productWarnings,
      ),
      seoDescription: clean(cols.get(headRow, 'seoDescription')),
      optionNames: realNames,
      variants,
      images,
      errors,
      warnings: productWarnings,
    });
  }

  const unsupported = new Set<string>();
  for (const header of headers) {
    if (header === '' || cols.used.has(header)) continue;
    if (rows.some((r) => (r[header] ?? '').trim() !== ''))
      unsupported.add(header);
  }

  return {
    products,
    rowIssues,
    unsupportedColumns: [...unsupported].sort(),
    warnings,
  };
}

// An image cell can hold several URLs separated by spaces, new lines, | ; or a
// comma that is followed by another URL. A comma inside a URL is left alone.
export function splitUrls(raw: string): string[] {
  const text = raw.trim();
  if (text === '') return [];
  return text
    .split(/[\s|;]+|,(?=\s*https?:\/\/)/i)
    .map((p) => p.trim())
    .filter((p) => p !== '');
}
