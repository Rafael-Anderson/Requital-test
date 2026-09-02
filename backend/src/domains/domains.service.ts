import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { DatabaseService } from '../database/database.service';
import type { RowDataPacket } from 'mysql2/promise';
import { createLogger } from '../common/logging/logger';

// Same STOREFRONT_ROOT_DOMAIN as ShopService (duplicated, not shared — this
// codebase already duplicates STOREFRONT_URL across half a dozen services
// rather than centralizing a one-line env read, see e.g. payments.service.ts).
const STOREFRONT_ROOT_DOMAIN =
  process.env.STOREFRONT_ROOT_DOMAIN ?? 'requital.io';

const logger = createLogger('DomainsService');

// resolveSubdomain is hit on EVERY storefront request (storefront/proxy.ts) and
// every uncached TLS handshake for a custom domain (Caddy `ask`). A 30s
// in-memory TTL turns that into at most one DB query per host per 30s. Chosen
// short on purpose: a connect / disconnect / verify must reflect quickly, and
// those three write paths call invalidate() so they're immediate anyway — the
// TTL only bounds staleness from something this service can't see (a direct DB
// edit, a sweep on another instance). docs/plans/custom-domain-resolver.md P6.
const RESOLVE_CACHE_TTL_MS = 30_000;
const RESOLVE_CACHE_MAX = 1_000;

@Injectable()
export class DomainsService {
  constructor(private readonly db: DatabaseService) {}

  private readonly resolveCache = new Map<
    string,
    { subdomain: string | null; expires: number }
  >();
  private cacheHits = 0;
  private cacheMisses = 0;

  // Backs Caddy's on-demand TLS `ask` config — called on every TLS handshake
  // for a hostname Caddy hasn't already got a cert for, so this needs to
  // stay a single indexed lookup and nothing heavier.
  async isKnownDomain(domain: string): Promise<boolean> {
    return (await this.resolveSubdomain(domain)) !== null;
  }

  // Backs the storefront's own middleware (see storefront/proxy.ts) — it needs
  // the shop's real subdomain to rewrite an incoming request onto the existing
  // /[shop]/... route tree, not just a yes/no. Two shapes of "known" domain,
  // matching the two site blocks that both point Caddy's `ask` at
  // isKnownDomain above (see the Caddyfile): a `{subdomain}.requital.io`
  // wildcard host (real for any shop with that subdomain, regardless of its
  // current domainType — a shop that switched to a custom domain shouldn't
  // suddenly break its old default URL), or a shop's own connected
  // customDomain, which resolves back to that same shop's subdomain (the app's
  // internal routing key is always the subdomain, never the custom domain
  // itself). Result is TTL-cached — see RESOLVE_CACHE_TTL_MS.
  async resolveSubdomain(domain: string): Promise<string | null> {
    const cached = this.resolveCache.get(domain);
    if (cached && cached.expires > Date.now()) {
      this.cacheHits++;
      return cached.subdomain;
    }
    this.cacheMisses++;
    const subdomain = await this.lookupSubdomain(domain);
    this.putCache(domain, subdomain);
    return subdomain;
  }

  private async lookupSubdomain(domain: string): Promise<string | null> {
    const suffix = `.${STOREFRONT_ROOT_DOMAIN}`;
    if (domain.endsWith(suffix)) {
      const subdomain = domain.slice(0, -suffix.length);
      const rows = await this.db.query<RowDataPacket[]>(
        `SELECT id FROM shop WHERE subdomain = ? LIMIT 1`,
        [subdomain],
      );
      return rows.length > 0 ? subdomain : null;
    }
    // A custom domain resolves ONLY once its DNS-TXT ownership check has passed
    // (customDomainStatus = 'verified' — see CustomDomainVerificationService).
    // A pending/verifying/failed claim must not route to any storefront. This
    // single clause also gates the Caddy on-demand-TLS `ask`
    // (GET /domains/verify), since isKnownDomain() above delegates here — an
    // unverified domain is neither served nor issued a cert.
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT subdomain FROM shop
       WHERE customDomain = ? AND domainType = 'custom' AND customDomainStatus = 'verified' LIMIT 1`,
      [domain],
    );
    return rows.length > 0 ? (rows[0].subdomain as string) : null;
  }

  private putCache(domain: string, subdomain: string | null): void {
    if (this.resolveCache.size >= RESOLVE_CACHE_MAX) {
      // Cheap FIFO eviction — a flood of junk hostnames can't grow it unbounded.
      for (const oldest of this.resolveCache.keys()) {
        this.resolveCache.delete(oldest);
        break;
      }
    }
    this.resolveCache.set(domain, {
      subdomain,
      expires: Date.now() + RESOLVE_CACHE_TTL_MS,
    });
  }

  // Called by ShopService.updateDomain (connect/disconnect) and
  // CustomDomainVerificationService.verifyClaim (verified/failed) so a domain
  // state change is reflected on the very next request, not after ≤30s.
  invalidate(domain: string): void {
    this.resolveCache.delete(domain);
  }

  @Interval(60_000)
  logCacheStats(): void {
    if (process.env.NODE_ENV === 'test') return;
    const total = this.cacheHits + this.cacheMisses;
    if (total === 0) return;
    logger.info('resolve-cache stats (last 60s window)', {
      hits: this.cacheHits,
      misses: this.cacheMisses,
      hitRate: +(this.cacheHits / total).toFixed(3),
      size: this.resolveCache.size,
    });
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

  // Backs the CORS origin check in main.ts — narrower than isKnownDomain on
  // purpose: the *.requital.io shape is already covered by a static regex
  // there before this is ever called, so the only case worth a DB round-trip
  // is a merchant's own connected custom domain.
  async isCustomDomain(domain: string): Promise<boolean> {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM shop WHERE customDomain = ? AND domainType = 'custom' LIMIT 1`,
      [domain],
    );
    return rows.length > 0;
  }
}
