// Tesseract gives raw text, nothing else — this layer turns that into
// candidate line items. It's heuristic, not guaranteed (OCR misreads,
// unusual invoice layouts, merged columns) — the review screen showing raw
// OCR text alongside these parsed rows is the actual mitigation, not
// smarter regexes here. Keep these patterns simple and legible over
// "clever" — a merchant fixing a wrong row by hand is the expected path,
// not an edge case to eliminate.

export const DEFAULT_EXCLUDE_KEYWORDS = [
  'subtotal',
  'total',
  'tax',
  'vat',
  'delivery fee',
  'delivery charge',
  'shipping',
  'thank you',
  'cash',
  'change',
  'balance',
  'discount',
  'payment',
  'invoice',
  'receipt',
  'date',
  'tel',
  'phone',
  'address',
  'signature',
  'cashier',
];

export interface ParsedLineItem {
  rawLine: string;
  name: string;
  quantity: number;
  price: number | null;
}

// Case-insensitive substring match, same convention as CSV import's
// category/tag matching elsewhere in this codebase — a merchant thinks in
// "does this word appear", not regex.
export function filterLines(
  rawText: string,
  excludeKeywords: string[],
  includeKeywords: string[],
): string[] {
  const excludes = excludeKeywords
    .map((k) => k.toLowerCase().trim())
    .filter(Boolean);
  const includes = includeKeywords
    .map((k) => k.toLowerCase().trim())
    .filter(Boolean);

  return rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((line) => {
      const lower = line.toLowerCase();
      if (excludes.some((k) => lower.includes(k))) return false;
      if (includes.length > 0 && !includes.some((k) => lower.includes(k)))
        return false;
      return true;
    });
}

// Order matters: quantity patterns are tried first (and removed from the
// line) so a trailing "2" from "...x2" doesn't also get mistaken for a
// price by the pattern below.
const QUANTITY_PATTERNS = [
  /\b(\d+)\s*[xX]\b/, // "2x Roses" / "Roses 2x" / "2 x Roses" — anywhere on the line
  /\b[xX]\s*(\d+)\b/, // "Roses x2"
  /\bqty[:\s]*(\d+)\b/i, // "Qty: 3" / "Qty 3"
  /\b(\d+)\s*pcs?\b/i, // "2 pcs" / "3 pc"
];

// Trailing number on the line, optionally AED-prefixed/suffixed — invoices
// consistently put the price last on a line item row.
const PRICE_PATTERN = /(?:AED\s*)?(\d+(?:\.\d{1,2})?)\s*(?:AED)?\s*$/i;

export function parseLine(rawLine: string): ParsedLineItem {
  let line = rawLine;
  let quantity = 1;

  for (const pattern of QUANTITY_PATTERNS) {
    const match = line.match(pattern);
    if (match) {
      quantity = Number(match[1]);
      line = (
        line.slice(0, match.index) +
        line.slice((match.index ?? 0) + match[0].length)
      ).trim();
      break;
    }
  }

  let price: number | null = null;
  const priceMatch = line.match(PRICE_PATTERN);
  if (priceMatch && priceMatch.index !== undefined) {
    price = Number(priceMatch[1]);
    line = line.slice(0, priceMatch.index).trim();
  }

  // Leading row-index numbering ("1. Rose Stems", "2) Lily Bunch") — only
  // when followed by '.' or ')', so a genuine leading quantity (already
  // consumed above) isn't double-stripped.
  line = line.replace(/^\d+[.)]\s*/, '').trim();

  const name = line.replace(/\s{2,}/g, ' ').trim();
  return { rawLine, name, quantity, price };
}

export function parseInvoiceText(
  rawText: string,
  excludeKeywords: string[],
  includeKeywords: string[],
): ParsedLineItem[] {
  return filterLines(rawText, excludeKeywords, includeKeywords)
    .map(parseLine)
    .filter((item) => item.name.length > 0);
}
