import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { TenantContext } from '../common/tenant-context';
import { InventoryAnalyticsService } from './inventory-analytics.service';
import { InventoryAnalyticsQueryDto } from './dto/inventory-analytics-query.dto';

// Mounted under /reports so the URL sits with the other merchant reports
// (general, monthly, product-sales, prep-time, margin), while the code lives in
// analytics/ next to the rollups it reads.
@Controller('reports/inventory')
export class AnalyticsController {
  constructor(
    private readonly inventoryAnalytics: InventoryAnalyticsService,
  ) {}

  @Get('movement')
  @Roles('admin', 'viewer')
  getMovement(
    @CurrentUser() ctx: TenantContext,
    @Query() query: InventoryAnalyticsQueryDto,
  ) {
    return this.inventoryAnalytics.getMovement(ctx, {
      days: query.days,
      deadStockDays: query.deadStockDays,
      outletId: query.outletId,
    });
  }
}
