import { Controller, Get, NotFoundException, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/decorators/public.decorator';
import { DomainsService } from './domains.service';

// Unauthenticated by design (Caddy's on-demand TLS `ask` config calls this
// directly, no token to send) — same @Public() shape as health.controller.ts.
// Answers with HTTP status alone: 200 means "issue a cert for this host,"
// anything else means "don't." Caddy's own ask docs treat non-2xx as a
// blanket no, so a plain 404 (no body needed) is enough.
@Controller('domains')
export class DomainsController {
  constructor(private readonly domainsService: DomainsService) {}

  // Tighter than the app-wide default: legitimate callers are sparse (Caddy
  // only consults this for a host it has no cached cert for), so a low per-IP
  // ceiling here caps an external prober / cert-issuance-abuse attempt without
  // touching real traffic. Jest skips throttling globally (see app.module.ts),
  // so this only bites in production and in the one e2e that flips NODE_ENV.
  //
  // GET /domains/resolve is deliberately NOT throttled: its one legitimate
  // caller is the storefront server itself, making every storefront request's
  // lookup from a single IP — a per-IP limit there would 429 real traffic into
  // a 404. Hardening it (internal-only caller / caching) is Phase 6 of
  // docs/plans/custom-domain-resolver.md.
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Public()
  @Get('verify')
  async verify(@Query('domain') domain?: string) {
    if (!domain || !(await this.domainsService.isKnownDomain(domain))) {
      throw new NotFoundException();
    }
    return { status: 'ok' };
  }

  // Backs storefront/middleware.ts's subdomain-aware routing — resolves the
  // real Host header (a {subdomain}.requital.io wildcard host or a
  // connected custom domain) to the shop's actual subdomain, which is what
  // the storefront app's own /[shop]/... route tree is keyed on internally.
  // Unauthenticated for the same reason as verify() above: the storefront
  // server itself calls this on every request, before any user session
  // exists.
  @Public()
  @Get('resolve')
  async resolve(@Query('host') host?: string) {
    const subdomain = host ? await this.domainsService.resolveSubdomain(host) : null;
    if (!subdomain) {
      throw new NotFoundException();
    }
    return { subdomain };
  }
}
