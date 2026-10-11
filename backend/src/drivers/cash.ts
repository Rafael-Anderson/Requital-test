import { minorUnitDecimals } from '../common/currency-minor-units';

// Exact decimal <-> integer minor units, with NO floating point anywhere.
//
// Cash reconciliation compares what a driver says they collected with the
// order's total. Both arrive as decimal strings (mysql2 returns DECIMAL(65,30)
// as "141.290000000000000000000000000000"), and `Number(x) * 100` followed by a
// comparison is exactly the shape that turns 1.005 into 100.49999999999999. So
// everything here is string/BigInt arithmetic, in the order's own currency.

const DECIMAL = /^(\d+)(?:\.(\d+))?$/;

// "141.29" or "141.290000..." -> 14129 (AED) / 141290 (KWD). More fractional
// digits than the currency has are ROUNDED half up on the first extra digit
// (an order total is already rounded to the currency, so in practice the extra
// digits are zeros). Returns null for anything that is not a plain non-negative
// decimal.
export function decimalToMinor(
  value: string | null | undefined,
  currency: string | null | undefined,
): number | null {
  if (typeof value !== 'string') return null;
  const m = DECIMAL.exec(value.trim());
  if (!m) return null;
  const decimals = minorUnitDecimals(currency);
  const frac = m[2] ?? '';
  const kept = frac.slice(0, decimals).padEnd(decimals, '0');
  let minor = BigInt(m[1] + kept);
  if (frac.length > decimals && frac.charCodeAt(decimals) >= 53 /* '5' */) {
    minor += 1n;
  }
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(minor);
}

// 14129 + AED -> "141.29"; 141290 + KWD -> "141.290". Always exactly the
// currency's number of decimals.
export function minorToDecimal(
  minor: number,
  currency: string | null | undefined,
): string {
  const decimals = minorUnitDecimals(currency);
  const sign = minor < 0 ? '-' : '';
  const abs = BigInt(Math.abs(Math.trunc(minor)));
  if (decimals === 0) return `${sign}${abs}`;
  const s = abs.toString().padStart(decimals + 1, '0');
  return `${sign}${s.slice(0, -decimals)}.${s.slice(-decimals)}`;
}

// What a driver types. Strict on purpose: a plain non-negative decimal with at
// most the currency's own number of places ("141.29", "141", "10.505" for KWD).
// A number such as 1e3, a negative, a comma, or an AED amount with three places
// is rejected rather than guessed at. Returns integer minor units.
export function parseCashInput(
  raw: unknown,
  currency: string | null | undefined,
): number | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  // A JSON number is accepted but is rendered by String(), which is exact for
  // any value a person would type (it only misbehaves past 21 digits or with
  // an exponent, both of which the pattern below rejects).
  const text = String(raw).trim();
  const m = DECIMAL.exec(text);
  if (!m || text.length > 18) return null;
  if ((m[2] ?? '').length > minorUnitDecimals(currency)) return null;
  return decimalToMinor(text, currency);
}
