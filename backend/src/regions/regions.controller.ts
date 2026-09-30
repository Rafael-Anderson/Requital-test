import { Controller, Get } from '@nestjs/common';
import { RegionsService } from './regions.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';

// Any authenticated staff role: the address forms in admin (draft orders,
// outlets, phone orders) need the list, and it is reference data scoped to the
// caller's own shop country, never to a request parameter.
@Controller('regions')
export class RegionsController {
  constructor(private readonly regionsService: RegionsService) {}

  @Get()
  list(@CurrentUser() ctx: TenantContext) {
    return this.regionsService.listForShop(ctx.shopId);
  }
}
