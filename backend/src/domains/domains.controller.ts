import { Controller, Get, NotFoundException, Query } from '@nestjs/common';
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

  @Public()
  @Get('verify')
  async verify(@Query('domain') domain?: string) {
    if (!domain || !(await this.domainsService.isKnownDomain(domain))) {
      throw new NotFoundException();
    }
    return { status: 'ok' };
  }
}
