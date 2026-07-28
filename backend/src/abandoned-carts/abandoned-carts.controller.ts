import { Controller, Get } from '@nestjs/common';
import { AbandonedCartsService } from './abandoned-carts.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';

// Admin-only — this is business-level marketing visibility (who nearly
// bought, what they nearly bought), same tier as Discounts/Affiliate, not
// a branch-level day-to-day operations concern.
@Roles('admin')
@Controller('abandoned-carts')
export class AbandonedCartsController {
  constructor(private readonly abandonedCartsService: AbandonedCartsService) {}

  @Get()
  findAll(@CurrentUser() ctx: TenantContext) {
    return this.abandonedCartsService.findAllForShop(ctx);
  }
}
