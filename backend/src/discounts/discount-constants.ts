export const DISCOUNT_TYPES = [
  'PERCENTAGE',
  'FIXED_AMOUNT',
  'FREE_SHIPPING',
] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];

export const DISCOUNT_APPLIES_TO = [
  'ALL_PRODUCTS',
  'SPECIFIC_PRODUCTS',
  'SPECIFIC_COLLECTIONS',
] as const;
export type DiscountAppliesTo = (typeof DISCOUNT_APPLIES_TO)[number];

// Whether a discount requires the customer to type a code ('code', the
// original and still-default behavior) or applies automatically to every
// matching cart with no customer action ('auto') — orthogonal to `type`
// (PERCENTAGE/FIXED_AMOUNT/FREE_SHIPPING, the amount math) and `appliesTo`
// (which products/collections it's scoped to, reused as-is for 'auto'
// rather than a separate single product_id/collection_id column).
export const DISCOUNT_KINDS = ['code', 'auto'] as const;
export type DiscountKind = (typeof DISCOUNT_KINDS)[number];

// Specific, not just true/false — the storefront/draft-order UI shows the
// customer why a code didn't apply, not a generic "invalid code".
export const DISCOUNT_REJECTION_REASONS = [
  'not_found',
  'inactive',
  'not_started',
  'expired',
  'min_purchase_not_met',
  'usage_limit_reached',
  'per_customer_limit_reached',
  'not_eligible',
] as const;
export type DiscountRejectionReason =
  (typeof DISCOUNT_REJECTION_REASONS)[number];

export const DISCOUNT_REJECTION_MESSAGES: Record<
  DiscountRejectionReason,
  string
> = {
  not_found: 'This code is not valid',
  inactive: 'This code is no longer active',
  not_started: 'This code is not active yet',
  expired: 'This code has expired',
  min_purchase_not_met:
    'Your order does not meet the minimum purchase amount for this code',
  usage_limit_reached: 'This code has reached its usage limit',
  per_customer_limit_reached:
    'You have already used this code the maximum number of times',
  not_eligible: 'This code does not apply to the items in your cart',
};

// What a PUBLIC (unauthenticated) caller is told. Not-found, inactive, not
// started and expired all answer identically, because each one on its own
// confirms that a code exists: with specific wording a guesser could list a
// shop's real codes. The rest (minimum purchase, usage limits, eligibility) are
// only ever reached once existence is already proven to the caller, so they
// stay specific. Staff routes (draft-order builder) keep the specific wording.
export const GENERIC_DISCOUNT_MESSAGE =
  'This code is not valid or cannot be applied';
export const DISCOUNT_EXISTENCE_ORACLE_REASONS: readonly DiscountRejectionReason[] =
  ['not_found', 'inactive', 'not_started', 'expired'];

export function isDiscountExistenceOracle(
  reason: DiscountRejectionReason | undefined,
): boolean {
  return (
    reason !== undefined && DISCOUNT_EXISTENCE_ORACLE_REASONS.includes(reason)
  );
}

// Collapses the oracle reasons to one answer (same reason, same message).
export function toPublicDiscountResult<
  T extends {
    valid: boolean;
    reason?: DiscountRejectionReason;
    message?: string;
  },
>(result: T): T {
  if (result.valid || !isDiscountExistenceOracle(result.reason)) return result;
  return { ...result, reason: 'not_found', message: GENERIC_DISCOUNT_MESSAGE };
}
