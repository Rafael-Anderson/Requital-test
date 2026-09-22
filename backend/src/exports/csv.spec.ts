import { escapeCsvCell, toCsvLine, UTF8_BOM } from './csv';

describe('escapeCsvCell', () => {
  it('passes a plain value through untouched', () => {
    expect(escapeCsvCell('Rose Bouquet')).toBe('Rose Bouquet');
    expect(escapeCsvCell(42)).toBe('42');
  });

  it('renders null and undefined as empty, never as the words', () => {
    expect(escapeCsvCell(null)).toBe('');
    expect(escapeCsvCell(undefined)).toBe('');
  });

  // The three characters that make a cell ambiguous. A merchant's address
  // field routinely contains commas, and product descriptions contain both
  // quotes and newlines.
  it('quotes a value containing a comma', () => {
    expect(escapeCsvCell('Dubai, UAE')).toBe('"Dubai, UAE"');
  });

  it('quotes and doubles an embedded quote', () => {
    expect(escapeCsvCell('the "big" one')).toBe('"the ""big"" one"');
  });

  it('quotes a value containing a newline or carriage return', () => {
    expect(escapeCsvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(escapeCsvCell('line1\r\nline2')).toBe('"line1\r\nline2"');
  });

  // A Date stringified by String() is locale- and TZ-dependent, so it would
  // differ between a developer's machine and the server. Callers format dates
  // explicitly; this is the guard for one that slips through.
  it('renders a Date as ISO rather than a locale string', () => {
    expect(escapeCsvCell(new Date('2026-09-22T10:30:00.000Z'))).toBe(
      '2026-09-22T10:30:00.000Z',
    );
  });

  it('does not quote a value that merely contains spaces or semicolons', () => {
    expect(escapeCsvCell('a b; c')).toBe('a b; c');
  });
});

describe('toCsvLine', () => {
  it('joins with commas and terminates with CRLF per RFC 4180', () => {
    expect(toCsvLine(['a', 'b', 'c'])).toBe('a,b,c\r\n');
  });

  it('keeps empty trailing cells so the column count stays stable', () => {
    expect(toCsvLine(['a', null, ''])).toBe('a,,\r\n');
  });

  it('escapes per cell, not per line', () => {
    expect(toCsvLine(['Dubai, UAE', 'plain'])).toBe('"Dubai, UAE",plain\r\n');
  });
});

describe('UTF8_BOM', () => {
  // Without it Excel guesses the system codepage and mangles Arabic shop and
  // product names, which is the common case for this app's merchants.
  it('is the single BOM code point', () => {
    expect(UTF8_BOM).toBe('﻿');
    expect(UTF8_BOM).toHaveLength(1);
  });
});
