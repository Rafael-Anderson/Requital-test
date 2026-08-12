import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import type { RowDataPacket } from 'mysql2/promise';

// Same STOREFRONT_ROOT_DOMAIN as ShopService (duplicated, not shared — this
// codebase already duplicates STOREFRONT_URL across half a dozen services
// rather than centralizing a one-line env read, see e.g. payments.service.ts).
const STOREFRONT_ROOT_DOMAIN =
  process.env.STOREFRONT_ROOT_DOMAIN ?? 'requital.io';

@Injectable()
export class DomainsService {
  constructor(private readonly db: DatabaseService) {}

  // Backs Caddy's on-demand TLS `ask` config — called on every TLS handshake
  // for a hostname Caddy hasn't already got a cert for, so this needs to
  // stay a single indexed lookup and nothing heavier.
  async isKnownDomain(domain: string): Promise<boolean> {
    return (await this.resolveSubdomain(domain)) !== null;
  }

  // Backs the storefront's own middleware (see storefront/middleware.ts) —
  // it needs the shop's real subdomain to rewrite an incoming request onto
  // the existing /[shop]/... route tree, not just a yes/no. Two shapes of
  // "known" domain, matching the two site blocks that both point Caddy's
  // `ask` at isKnownDomain above (see the Caddyfile): a
  // `{subdomain}.requital.io` wildcard host (real for any shop with that
  // subdomain, regardless of its current domainType — a shop that switched
  // to a custom domain shouldn't suddenly break its old default URL), or a
  // shop's own connected customDomain, which resolves back to that same
  // shop's subdomain (the app's internal routing key is always the
  // subdomain, never the custom domain itself).
  async resolveSubdomain(domain: string): Promise<string | null> {
    const suffix = `.${STOREFRONT_ROOT_DOMAIN}`;
    if (domain.endsWith(suffix)) {
      const subdomain = domain.slice(0, -suffix.length);
      const rows = await this.db.query<RowDataPacket[]>(
        `SELECT id FROM shop WHERE subdomain = ? LIMIT 1`,
        [subdomain],
      );
      return rows.length > 0 ? subdomain : null;
    }
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT subdomain FROM shop WHERE customDomain = ? AND domainType = 'custom' LIMIT 1`,
      [domain],
    );
    return rows.length > 0 ? (rows[0].subdomain as string) : null;
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
