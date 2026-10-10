import { Body, Controller, Get, Param, ParseIntPipe, Post } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';
import { StoreCreditService } from './store-credit.service';
import { AdjustStoreCreditDto } from './dto/store-credit.dto';

// Role decision. Store credit is money owed to a customer, and customers are
// shop-wide with no outlet boundary, so 'branch' and 'order_manager' get nothing
// here (a branch account could otherwise mint credit that is spendable at every
// outlet, outside its own slice). Reading is admin + viewer (the tier that can
// read the customer record); granting and deducting is admin only.
@Controller('customers/:id/store-credit')
export class StoreCreditController {
  constructor(private readonly storeCredit: StoreCreditService) {}

  @Roles('admin', 'viewer')
  @Get()
  overview(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.storeCredit.overview(ctx.shopId, id);
  }

  @Roles('admin')
  @Post('adjustments')
  adjust(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AdjustStoreCreditDto,
  ) {
    return this.storeCredit.adjust(ctx, id, dto);
  }
}
