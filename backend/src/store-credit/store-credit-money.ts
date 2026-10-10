import { BadRequestException } from '@nestjs/common';
import { minorUnitDecimals, minorUnitFactor } from '../common/currency-minor-units';

// Store-credit amounts are handled as INTEGER MINOR UNITS everywhere they are
// added, compared or capped (fils, cents): no float is ever summed or compared.
// The DB column is DECIMAL(14,3), so a value read back is a fixed-scale decimal
// string such as "12.500"; these helpers move between that and integers with
// string arithmetic only.

// "12.500" (scale 3, as mysql2 returns DECIMAL) -> 1250 for a 2-decimal currency.
// Throws on a value the currency cannot represent (a non-zero digit beyond its
// decimals): that would mean a row was written with the wrong precision.
export function decimalToMinor(value: string, currency: string): number {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!m) throw new Error(`Not a decimal: ${value}`);
  const decimals = minorUnitDecimals(currency);
  const frac = (m[3] ?? '').padEnd(decimals, '0');
  const kept = frac.slice(0, decimals);
  if (/[1-9]/.test(frac.slice(decimals))) {
    throw new Error(`${value} has more precision than ${currency} allows`);
  }
  const minor = Number(m[2]) * minorUnitFactor(currency) + Number(kept || '0');
  return m[1] === '-' ? -minor : minor;
}

// 1250 -> "12.50" (2dp) or "12.500" (3dp); the sign is kept.
export function minorToDecimal(minor: number, currency: string): string {
  const factor = minorUnitFactor(currency);
  const decimals = minorUnitDecimals(currency);
  const abs = Math.abs(minor);
  const whole = Math.trunc(abs / factor);
  const frac = abs % factor;
  const body =
    decimals === 0 ? String(whole) : `${whole}.${String(frac).padStart(decimals, '0')}`;
  return minor < 0 ? `-${body}` : body;
}

// The most any single grant, deduction or balance may be in major units. Keeps
// every sum far inside both DECIMAL(14,3) and the safe-integer range.
export const MAX_CREDIT_MAJOR = 1_000_000;

// An admin-typed amount: a positive decimal with no more places than the
// currency has. Rejected, never rounded: "10.505 AED" is a typo, not 10.51.
export function parseAdminAmount(raw: unknown, currency: string): number {
  const text = typeof raw === 'number' && Number.isFinite(raw) ? String(raw) : raw;
  if (typeof text !== 'string' || !/^\d{1,7}(\.\d{1,3})?$/.test(text)) {
    throw new BadRequestException('amount must be a positive number');
  }
  const decimals = minorUnitDecimals(currency);
  const frac = text.split('.')[1] ?? '';
  if (frac.length > decimals) {
    throw new BadRequestException(`${currency} amounts have at most ${decimals} decimal places`);
  }
  const minor = decimalToMinor(text, currency);
  if (minor <= 0) throw new BadRequestException('amount must be greater than zero');
  if (minor > MAX_CREDIT_MAJOR * minorUnitFactor(currency)) {
    throw new BadRequestException(`amount cannot exceed ${MAX_CREDIT_MAJOR}`);
  }
  return minor;
}
