// The one place admin formats a money amount.
//
// Before this there was no helper at all: ~60 call sites each inlined
// `${x.toFixed(2)} AED`, so the currency was asserted sixty times over and the
// decimal width was hardcoded at every one. A shop trading in KWD would have had
// its amounts rendered with two decimals and labelled AED, on every page.
//
// Deliberately the ISO CODE, not a symbol — matching what admin has always
// shown, and the same choice backend/src/common/money-format.ts makes. The
// storefront renders the real Dirham glyph via <CurrencySymbol> because it
// controls its own typography; admin is a dense data tool where an unambiguous
// three-letter code reads better in a table than a glyph that may not resolve.
//
// Kept as a hand-maintained mirror of the backend's minor-unit map rather than
// imported: admin and backend share nothing but the HTTP boundary (see the root
// CLAUDE.md), so there is no module to import. The list is short, stable and
// ISO-defined; if it ever drifts, the symptom is a wrong decimal width rather
// than a wrong amount, because the backend is what actually rounds and charges.
const MINOR_UNIT_DECIMALS: Record<string, number> = {
  AED: 2,
  SAR: 2,
  QAR: 2,
  USD: 2,
  KWD: 3,
  BHD: 3,
  OMR: 3,
};

const DEFAULT_DECIMALS = 2;

export function currencyDecimals(currency: string | null | undefined): number {
  if (!currency) return DEFAULT_DECIMALS;
  return MINOR_UNIT_DECIMALS[currency.trim().toUpperCase()] ?? DEFAULT_DECIMALS;
}

// "199.00 AED". Accepts the DECIMAL strings the API returns as well as numbers,
// since every money field arrives as a string from mysql2 via the backend.
export function formatMoney(
  amount: number | string | null | undefined,
  currency: string | null | undefined,
): string {
  const code = (currency ?? "").trim().toUpperCase();
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (n === null || n === undefined || !Number.isFinite(n)) {
    // Never render "NaN AED" into a merchant's dashboard. Showing the code alone
    // keeps the column aligned and leaves the missing value visible instead of
    // masking it as 0.
    return code;
  }
  // Thousands separators with a pinned locale: SimpleDashboard already used
  // toLocaleString() and would otherwise have silently lost them, while every
  // other site used toFixed() and never had them. "en-US" rather than the
  // runtime default so the output is deterministic in CI and in tests.
  const fixed = n.toLocaleString("en-US", {
    minimumFractionDigits: currencyDecimals(code),
    maximumFractionDigits: currencyDecimals(code),
  });
  return code ? `${fixed} ${code}` : fixed;
}

// Amount only, no code — for the handful of places that render the code
// separately (a table header, a column label) and would otherwise repeat it on
// every row.
export function formatAmount(
  amount: number | string | null | undefined,
  currency: string | null | undefined,
): string {
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (n === null || n === undefined || !Number.isFinite(n)) return "";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: currencyDecimals(currency),
    maximumFractionDigits: currencyDecimals(currency),
  });
}
