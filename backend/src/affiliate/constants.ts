export const AFFILIATE_STATUSES = ['active', 'inactive', 'blocked'] as const;
export const AFFILIATE_CODE_STATUSES = ['approved', 'pending', 'blocked'] as const;
export const COMMISSION_TYPES = ['percentage', 'fixed'] as const;
// Only ever set automatically (order lifecycle) or manually while still
// 'pending' — see AffiliateService.
export const AFFILIATE_ORDER_STATUSES = ['pending', 'approved', 'blocked'] as const;
