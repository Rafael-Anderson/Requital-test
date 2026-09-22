// CSV serialisation for server-side report exports (ANL-11).
//
// Deliberately mirrors admin/lib/csv.ts's escaping and BOM rules rather than
// inventing a second dialect: the two produce byte-identical output for the
// same rows, so moving an export from the client to the server cannot silently
// change the file a merchant opens. The admin copy stays for anything still
// exporting in-page; this is the one the streaming endpoints use.

// Excel is still the most common opener and guesses the system codepage
// without this, mangling Arabic shop/product names.
export const UTF8_BOM = '﻿';

export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = stringify(value);
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

// Narrowed rather than a bare String(): an object would otherwise land in the
// file as the literal text "[object Object]", which looks like data and is
// impossible to debug from the spreadsheet. A Date is formatted explicitly
// because its default stringification is locale- and timezone-dependent, so
// the same row would export differently on the server and on a developer
// machine.
function stringify(value: NonNullable<unknown>): string {
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  if (
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    typeof value === 'boolean'
  ) {
    return String(value);
  }
  return JSON.stringify(value) ?? '';
}

// CRLF, not LF: RFC 4180, and the line ending Excel expects.
export function toCsvLine(cells: readonly unknown[]): string {
  return cells.map(escapeCsvCell).join(',') + '\r\n';
}
