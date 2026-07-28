// Column names must match admin/lib/csv.ts's PRODUCT_IMPORT_HEADERS exactly
// (export writes these headers, import reads them back) — there's no shared
// package between admin/ and backend/, so this is the single source of
// truth on the backend side and the frontend constant is kept in sync by
// hand, same as every other cross-app "API shape" contract in this repo.
export const PRODUCT_IMPORT_HEADERS = [
  'Handle',
  'Name',
  'Description',
  'SKU',
  'Barcode',
  'Price',
  'Compare At Price',
  'Cost Price',
  'Status',
  'Track Inventory',
  'Charge Tax',
  'Vendor',
  'Product Type',
  'Thumbnail URL',
  'Categories',
  'Tags',
  'Variant',
  'Variant SKU',
  'Variant Price',
  'Variant Compare At Price',
  'Stock',
] as const;

export const INGREDIENT_IMPORT_HEADERS = ['Name', 'Unit', 'Track Inventory', 'Stock'] as const;

export type ImportAction = 'create' | 'update' | 'reject';
export type ImportRowKind = 'product' | 'variant' | 'ingredient';

export interface ImportRowResult {
  rowNumber: number;
  kind: ImportRowKind;
  identifier: string;
  action: ImportAction;
  errors: string[];
}

export function parseImportBoolean(value: string): boolean | undefined {
  if (!value) return undefined;
  const v = value.trim().toLowerCase();
  if (['true', '1', 'yes'].includes(v)) return true;
  if (['false', '0', 'no'].includes(v)) return false;
  return undefined;
}

// Returns undefined for a blank cell (meaning "not provided" — leave
// unchanged on update), NaN for a present-but-unparseable cell (the caller
// turns that into a validation error, distinct from "not provided").
export function parseImportNumber(value: string): number | undefined {
  if (!value.trim()) return undefined;
  return Number(value);
}

export function splitList(value: string): string[] {
  return value
    .split(';')
    .map((v) => v.trim())
    .filter(Boolean);
}
