import { dateKeyInTimezone } from '../outlets/outlet-status';

// Resolve the storefront-facing "show a NEW badge" boolean for a product.
// Pure + no DB so the timezone edge (an expiry evaluated in the SHOP's
// timezone, never the server's or the browser's — stakeholder #6) is
// directly unit-testable.
//
// `newUntilKey` is the raw calendar date the merchant picked, as a
// 'YYYY-MM-DD' string (read via `DATE_FORMAT(newUntil, '%Y-%m-%d')`), or
// null for "no expiry". It carries no timezone of its own — the merchant
// means "new through the end of that day, shop-local" — so only "today"
// needs timezone resolution; the comparison is then a plain lexical
// string compare of two ISO date keys.
export function resolveProductIsNew(
  isNew: boolean,
  newUntilKey: string | null,
  shopTimezone: string,
  now: Date = new Date(),
): boolean {
  if (!isNew) return false;
  if (!newUntilKey) return true;
  return newUntilKey >= dateKeyInTimezone(now, shopTimezone);
}
