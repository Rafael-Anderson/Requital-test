import { Controller, Get, Query } from '@nestjs/common';
import { SearchService } from './search.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';

// No @Roles restriction — every authenticated role can hit this, but each
// category inside SearchService.search is independently scoped to match
// what that role could already see via the real list endpoints (customers
// silently omitted for branch/order_manager, orders outlet-pinned for
// branch) — see SearchService for the exact mapping.
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  search(@CurrentUser() ctx: TenantContext, @Query('q') q: string) {
    return this.searchService.search(ctx, q);
  }
}
