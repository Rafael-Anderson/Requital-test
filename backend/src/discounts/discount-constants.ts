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
