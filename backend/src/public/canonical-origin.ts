// The one public origin a shop's pages should be indexed under.
//
// A shop is reachable at several hosts at once - the path form
// (/{subdomain}/...), its own {subdomain}.requital.io, and, once verified, its
// custom domain - all serving identical content. A <link rel="canonical">
// pointing at one of them is what stops that reading as duplicate content, so
// this has to resolve to exactly one, the same for every request.
//
// Mirrors admin's storefrontUrlFor with one deliberate difference: a custom
// domain only counts when it is **verified**. An unverified claim is not
// served at all (DomainsService.resolveSubdomain gates on 'verified'), so
// canonicalising to it would point crawlers at a host that 404s - the one
// failure mode worse than no canonical tag.
const STOREFRONT_ROOT_DOMAIN =
  process.env.STOREFRONT_ROOT_DOMAIN ?? 'requital.io';

export function resolveCanonicalOrigin(shop: {
  subdomain: string;
  domainType: string | null;
  customDomain: string | null;
  customDomainStatus: string | null;
}): string {
  if (
    shop.domainType === 'custom' &&
    shop.customDomain &&
    shop.customDomainStatus === 'verified'
  ) {
    return `https://${shop.customDomain}`;
  }
  return `https://${shop.subdomain}.${STOREFRONT_ROOT_DOMAIN}`;
}
