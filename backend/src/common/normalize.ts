// Pure input-normalization helpers for fields the user can type in several
// equally-valid raw formats — sibling to phone.ts's normalizePhoneToE164
// (re-exported here so every call site importing "normalization" has one
// place to look), applied via DTO @Transform decorators before validation
// runs, so validators only ever see the canonical stored shape.
export { normalizePhoneToE164 } from './phone';

// Accepts with or without a protocol ("example.com" or "https://example.com")
// and normalizes to always having one, defaulting to https:// — merchants
// type bare domains far more often than they type a protocol.
export function normalizeWebsiteUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

// TRNs get typed with all sorts of dash/space grouping — storage format is
// digits-only, canonical and unambiguous regardless of how it was typed.
export function normalizeTrn(raw: string): string {
  return raw.replace(/[^0-9]/g, '');
}
