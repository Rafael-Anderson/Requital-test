// The four VAT treatments a line can carry, matching the capability audit's
// own shape (docs/plans/product-capability-audit.md, I18N-5).
//
// `zero` and `exempt` are BOTH 0% and are NOT interchangeable: a zero-rated
// supply is taxable at 0% and keeps input-tax recovery, an exempt one is
// outside the recovery scheme, and `out_of_scope` is not a supply for VAT at
// all. They price identically and report differently, which is exactly why
// `type` exists alongside `rate` instead of a bare rate column.
export const TAX_CLASS_TYPES = [
  'standard',
  'zero',
  'exempt',
  'out_of_scope',
] as const;

export type TaxClassType = (typeof TAX_CLASS_TYPES)[number];

// Only `standard` may carry a non-zero rate. A `zero` class at 5% is not a
// configuration this platform should be able to represent — it would quietly
// charge VAT on something the merchant has declared zero-rated, which is the
// wrong-return bug this whole feature exists to fix.
export function typeAllowsNonZeroRate(type: string): boolean {
  return type === 'standard';
}
