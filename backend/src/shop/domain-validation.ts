// Pure validators for shop.customDomain — kept framework-free (no
// class-validator dependency) so domain-validation.spec.ts can exercise them
// directly, same reasoning as admin/lib/validators.ts on the frontend side.
//
// Mirrored by hand in admin/lib/validators.ts's validateCustomDomain. KEEP IN
// SYNC: the hostname shape AND the platform-domain / reserved-label rejection
// below both have a hand-written twin there — editing one is a prompt to check
// the other.

import { RESERVED_SUBDOMAINS } from './constants';

// A conservative real-hostname check: labels of letters/digits/hyphens (no
// leading/trailing hyphen per-label), at least one dot, a letters-only TLD.
// Deliberately doesn't allow a protocol, path, port, or trailing slash —
// normalizeCustomDomain() strips those before this ever runs, so rejecting
// them here is defense-in-depth against a caller that skipped that step.
const HOSTNAME_REGEX =
  /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))*\.[a-z]{2,63}$/;

// The platform's own root domain. Hardcoded (and mirrored in
// admin/lib/validators.ts) the same way every other root-domain literal in
// this codebase is — see ShopService's STOREFRONT_ROOT_DOMAIN fallback.
const PLATFORM_ROOT_DOMAIN = 'requital.io';

// A merchant's "custom" domain must never be a Requital-owned hostname: the
// bare apex, anything under *.requital.io (which is what actually covers every
// reserved subdomain — api./admin./www. etc. — in one shot), or, belt-and-
// braces, a bare reserved label (the TLD requirement above already precludes
// one reaching here, but the check costs nothing and keeps the intent explicit).
function isPlatformOwnedHost(value: string): boolean {
  return (
    value === PLATFORM_ROOT_DOMAIN ||
    value.endsWith(`.${PLATFORM_ROOT_DOMAIN}`) ||
    RESERVED_SUBDOMAINS.includes(value)
  );
}

export function isValidCustomDomain(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 253 &&
    HOSTNAME_REGEX.test(value) &&
    !isPlatformOwnedHost(value)
  );
}
