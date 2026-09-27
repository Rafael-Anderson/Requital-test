// Currency code -> display symbol (storefront-v2 Phase 2G). Every price
// display in this app renders shop.currency (or order.currency) directly
// as plain text rather than a hardcoded "AED" string, so there was nothing
// to grep-and-replace in JSX — the fix is here, at the one place a currency
// code becomes user-facing text. shop.currency itself (arithmetic, API
// payloads, DB storage) is untouched; this is display-only. Every shop is
// AED-only today (see CLAUDE.md's "single-currency AED throughout") but the
// map is keyed by code rather than hardcoding a single symbol everywhere,
// so a second currency wouldn't silently render the wrong glyph.
//
// Bug 7 fix: this plain-string AED entry is no longer what most call sites
// render — components/CurrencySymbol.tsx renders AED as an inline SVG of
// the actual UAE Dirham currency symbol instead (this string, "د.إ", is
// Arabic text for "dirham," not that symbol) and is what every JSX call
// site should use now. This map/function stays for the rare genuinely
// non-JSX string context (e.g. an `alt`/`title` attribute, or code outside
// a component) where an inline SVG isn't an option.
// DELIBERATELY still one entry. The obvious A5b move was to add the other six
// currencies here, but this file's own Bug 7 note above explains why that is a
// trap: the AED string "د.إ" is Arabic TEXT for "dirham", not the currency
// symbol, which is exactly the mistake that forced CurrencySymbol.tsx to render
// an inline SVG instead. Adding ﷼ / د.ك / ر.ع. would repeat it six times over
// with glyphs that render inconsistently across fonts. currencySymbol() already
// falls back to the ISO code for an unknown currency, and "1,234.500 KWD" is
// unambiguous and always renders. A real symbol per currency is a design task
// (it needs the same SVG treatment AED got), not a map entry.
const CURRENCY_SYMBOLS: Record<string, string> = {
  AED: "د.إ",
};

export function currencySymbol(code: string | null | undefined): string {
  if (!code) return "";
  return CURRENCY_SYMBOLS[code] ?? code;
}

// Minor-unit decimals per currency — a hand-maintained mirror of the backend's
// common/currency-minor-units.ts. KWD/BHD/OMR have THREE, so a hardcoded
// .toFixed(2) renders a different amount, not just a differently-styled one.
const CURRENCY_DECIMALS: Record<string, number> = {
  AED: 2,
  SAR: 2,
  QAR: 2,
  USD: 2,
  KWD: 3,
  BHD: 3,
  OMR: 3,
};

export function currencyDecimals(code: string | null | undefined): number {
  if (!code) return 2;
  return CURRENCY_DECIMALS[code.trim().toUpperCase()] ?? 2;
}

// The amount only. Every storefront price renders <CurrencySymbol> beside it, so
// this deliberately does NOT append a code or symbol — it exists purely to stop
// the ~12 `.toFixed(2)` call sites from asserting two decimals.
export function formatPriceAmount(
  value: number | string | null | undefined,
  code: string | null | undefined,
): string {
  const n = typeof value === "string" ? Number(value) : value;
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  return n.toFixed(currencyDecimals(code));
}
