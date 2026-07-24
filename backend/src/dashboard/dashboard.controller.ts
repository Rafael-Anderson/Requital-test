import { Controller, Get, Query } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { DashboardQueryDto } from './dto/dashboard-query.dto';
import { TopProductsQueryDto } from './dto/top-products-query.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('summary')
  getSummary(
    @CurrentUser() ctx: TenantContext,
    @Query() query: DashboardQueryDto,
  ) {
    return this.dashboardService.getSummary(
      ctx,
      query.from,
      query.to,
      query.outletId,
    );
  }

  @Get('revenue-daily')
  getDailyRevenue(
    @CurrentUser() ctx: TenantContext,
    @Query() query: DashboardQueryDto,
  ) {
    return this.dashboardService.getDailyRevenue(
      ctx,
      query.from,
      query.to,
      query.outletId,
    );
  }

  @Get('top-products')
  getTopProducts(
    @CurrentUser() ctx: TenantContext,
    @Query() query: TopProductsQueryDto,
  ) {
    return this.dashboardService.getTopProducts(
      ctx,
      query.from,
      query.to,
      query.limit,
      query.outletId,
    );
  }
}
