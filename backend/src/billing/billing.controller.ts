import { Controller, Get } from '@nestjs/common';
import { BillingService } from './billing.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';

// Shop admins READ their own plan and usage. There is no write route in this
// controller or anywhere a shop admin can reach: plans and subscriptions are
// changed only by Requital staff (platform-admin tier) and, later, by Stripe.
@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Roles('admin')
  @Get('subscription')
  subscription(@CurrentUser() ctx: TenantContext) {
    return this.billing.getSubscription(ctx.shopId);
  }

  @Roles('admin')
  @Get('usage')
  usage(@CurrentUser() ctx: TenantContext) {
    return this.billing.getUsage(ctx.shopId);
  }
}
