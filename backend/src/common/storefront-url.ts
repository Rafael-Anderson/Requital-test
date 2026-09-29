// Every customer-facing URL this backend builds goes through here.
//
// WHY THIS EXISTS. Until now each consumer built its own
// `${STOREFRONT_URL}/${shopSlug}/...`, from eight identical copies of
// `process.env.STOREFRONT_URL`. Both halves of that were wrong in production:
//
//   1. STOREFRONT_URL was set to the APEX (https://requital.io), whose only job
//      in deploy/Caddyfile is `redir https://admin.requital.io{uri} 301`. So a
//      customer finishing a Stripe payment was redirected to the merchant admin
//      login. Same for Tabby, Tamara, PayPal, and every customer email link
//      (cart recovery, survey, password reset, back-in-stock, bio, affiliate).
//
//   2. The SHAPE was unreachable regardless of the host. storefront/proxy.ts
//      resolves every non-local hostname to a tenant and always PREPENDS the
//      resolved slug to the path, so a slug already in the path gets doubled:
//      https://dff.requital.io/orders/3      -> 200
//      https://dff.requital.io/dff/orders/3  -> 404
//
// A shop's real public address is a HOST, not a path prefix — which the codebase
// already knew: admin/lib/api.ts's storefrontUrlFor says the bare-path shape
// "stopped being this shop's real public address once per-shop domains shipped",
// and ShopService's own comment notes STOREFRONT_ROOT_DOMAIN is "the root domain
// a shop's own subdomain hangs off of, NOT the full base URL". That lesson was
// applied to the merchant-facing "your store is live at" link and to SEO
// canonicals, and never to the customer-facing links. This closes that gap.
import { createLogger } from './logging/logger';

const logger = createLogger('StorefrontUrl');

// The domain a platform-hosted shop's own subdomain hangs off of. Same env var
// and same fallback as ShopService, DomainsService and (as
// NEXT_PUBLIC_STOREFRONT_ROOT_DOMAIN) admin/lib/api.ts. Unset in every
// environment today, so 'requital.io' is the live value everywhere.
const STOREFRONT_ROOT_DOMAIN =
  process.env.STOREFRONT_ROOT_DOMAIN ?? 'requital.io';

export interface ShopUrlFields {
  subdomain: string;
  domainType: string | null;
  customDomain: string | null;
  customDomainStatus: string | null;
}

// Mirrors storefront/lib/is-local-host.ts EXACTLY. Restated rather than imported
// because the backend and storefront share no code (see the root CLAUDE.md:
// "Three independent apps in one repo, sharing nothing but the HTTP boundary").
// If that file's rule changes, change this one with it — the two must agree, or
// a dev redirect gets prefixed for the wrong mode.
function isLocalHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname.endsWith('.local')
  );
}

// In local dev there are no per-shop hostnames — nothing resolves
// `dff.localhost:3002` — and proxy.ts deliberately passes local hosts straight
// through WITHOUT prepending a slug, so the path form is the only shape that
// works there. This returns STOREFRONT_URL only when it genuinely points at a
// local host; a non-local value (like production's apex) is ignored rather than
// trusted, which is what makes the live misconfiguration inert instead of wrong.
function devPathBase(): string | null {
  // The ONLY remaining read of STOREFRONT_URL in this codebase, and it is a
  // dev-only escape hatch. tools/check-storefront-url.js enforces that no
  // other module reads it. Read per call rather than at module load so a test
  // can exercise both branches without re-importing the module.
  const STOREFRONT_URL = process.env.STOREFRONT_URL;
  if (!STOREFRONT_URL) return null;
  try {
    const { hostname } = new URL(STOREFRONT_URL);
    return isLocalHostname(hostname) ? STOREFRONT_URL.replace(/\/+$/, '') : null;
  } catch {
    logger.warn('STOREFRONT_URL is not a valid URL — ignoring it', {
      value: STOREFRONT_URL,
    });
    return null;
  }
}

// The one public origin a shop is addressable at.
//
// A custom domain counts ONLY when verified. That is not a nicety: production
// currently has two shops with domainType='custom' and customDomainStatus NULL,
// and one of those domains serves an unrelated third-party website. Sending a
// paying customer there would be worse than any 404. DomainsService's resolver
// and the Caddy on-demand-TLS `ask` hook both gate on exactly this string, so a
// non-verified domain is not served by us at all.
//
// Deliberately NOT the same rule as ShopService.getDomainConfig's `storefrontUrl`
// or admin's storefrontUrlFor, both of which show the claimed domain regardless
// of verification. Those are merchant-facing, shown beside a status indicator;
// this one is where customers get sent.
export function resolveCanonicalOrigin(shop: ShopUrlFields): string {
  if (
    shop.domainType === 'custom' &&
    shop.customDomain &&
    shop.customDomainStatus === 'verified'
  ) {
    return `https://${shop.customDomain}`;
  }
  return `https://${shop.subdomain}.${STOREFRONT_ROOT_DOMAIN}`;
}

// Build a customer-facing storefront URL for a shop.
//
// `path` is root-relative and must start with '/' — it is the path WITHOUT the
// shop slug, because on a real host the slug is the host. proxy.ts adds it back.
export function storefrontUrl(shop: ShopUrlFields, path: string): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  const devBase = devPathBase();
  // Dev keeps the slug in the path, because that is the only form a local host
  // serves. Production never does.
  if (devBase) return `${devBase}/${shop.subdomain}${suffix}`;
  return `${resolveCanonicalOrigin(shop)}${suffix}`;
}
