// Shared between ShopService (getDomainConfig / updateDomain) and
// CustomDomainVerificationService — kept in its own file so `shop.service.ts`
// can import the record prefix + status type without importing the verification
// *service* (which pulls in JobsModule's SchedulerService and the DNS wrapper).

// The DNS TXT record host a merchant creates under their own zone to prove
// control: `_requital-verify.<their-domain>` with the value set to their
// claim's customDomainVerifyToken.
export const VERIFY_RECORD_PREFIX = '_requital-verify';

// shop.customDomainStatus vocabulary. NULL (not in this union) means "no custom
// domain claim". docs/plans/custom-domain-resolver.md Phase 2.
export type CustomDomainStatus =
  | 'pending' // claim created, no DNS check has run yet
  | 'verifying' // at least one check ran and missed; still inside the 48h window
  | 'verified' // DNS TXT matched; this shop now owns the domain exclusively
  | 'failed'; // 48h elapsed with no match, or the domain was verified elsewhere
