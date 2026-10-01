import { Body, Controller, Get, Patch } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';
import { ShopAnalyticsService } from './shop-analytics.service';
import { UpdateAnalyticsSettingsDto } from './dto/update-analytics-settings.dto';

// Same access tier as Payments / Messaging settings: admin only. The shop is
// always ctx.shopId; there is no id in the path to spoof.
@Roles('admin')
@Controller('analytics-settings')
export class ShopAnalyticsController {
  constructor(private readonly service: ShopAnalyticsService) {}

  @Get()
  find(@CurrentUser() ctx: TenantContext) {
    return this.service.find(ctx);
  }

  @Patch()
  update(
    @CurrentUser() ctx: TenantContext,
    @Body() dto: UpdateAnalyticsSettingsDto,
  ) {
    return this.service.update(ctx, dto);
  }
}
