// Currency code -> display symbol (storefront-v2 Phase 2G). Every price
// display in this app renders shop.currency (or order.currency) directly
// as plain text rather than a hardcoded "AED" string, so there was nothing
// to grep-and-replace in JSX — the fix is here, at the one place a currency
// code becomes user-facing text. shop.currency itself (arithmetic, API
// payloads, DB storage) is untouched; this is display-only. Every shop is
// AED-only today (see CLAUDE.md's "single-currency AED throughout") but the
// map is keyed by code rather than hardcoding a single symbol everywhere,
// so a second currency wouldn't silently render the wrong glyph.
const CURRENCY_SYMBOLS: Record<string, string> = {
  AED: "د.إ",
};

export function currencySymbol(code: string | null | undefined): string {
  if (!code) return "";
  return CURRENCY_SYMBOLS[code] ?? code;
}
