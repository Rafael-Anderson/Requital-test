// Plain-string-enum convention (no Prisma enums anywhere in this schema —
// see order.status, shop.paymentGateway, etc.), documented on the model.
export const POLICY_PAGE_TYPES = [
  'TERMS',
  'PRIVACY',
  'REFUND',
  'PAYMENT',
  'SHIPPING',
] as const;
export type PolicyPageType = (typeof POLICY_PAGE_TYPES)[number];

export const POLICY_PAGE_LABELS: Record<PolicyPageType, string> = {
  TERMS: 'Terms & Conditions',
  PRIVACY: 'Privacy Policy',
  REFUND: 'Refund & Return Policy',
  PAYMENT: 'Payment Policy',
  SHIPPING: 'Shipping & Delivery Policy',
};
