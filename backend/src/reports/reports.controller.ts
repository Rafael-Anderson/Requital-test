import { Controller, Get, Query } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { ReportsFilterQueryDto } from './dto/reports-filter-query.dto';
import { ListGeneralReportQueryDto } from './dto/list-general-report-query.dto';
import { ListProductSalesQueryDto } from './dto/list-product-sales-query.dto';
import { MonthlyReportFilterDto } from './dto/monthly-report-filter.dto';
import { ListMonthlyReportQueryDto } from './dto/list-monthly-report-query.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';

// Admin + viewer (read-only/reporting role) — same access level as
// Dashboard/Customers (business analytics, not something branch staff need
// broad access to). Flagged per the task rather than assumed: an
// outlet-scoped view for branch users would be a reasonable follow-up
// (mirroring how Dashboard already accepts an outletId a branch user gets
// force-pinned to), but General/Product Sale Reports read across the whole
// shop by design here, same boundary as Customers.
@Roles('admin', 'viewer')
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('general/summary')
  getGeneralSummary(
    @CurrentUser() ctx: TenantContext,
    @Query() query: ReportsFilterQueryDto,
  ) {
    return this.reportsService.getGeneralSummary(ctx, query);
  }

  @Get('general/orders')
  listGeneralOrders(
    @CurrentUser() ctx: TenantContext,
    @Query() query: ListGeneralReportQueryDto,
  ) {
    return this.reportsService.listGeneralOrders(ctx, query);
  }

  @Get('monthly/summary')
  getMonthlySummary(
    @CurrentUser() ctx: TenantContext,
    @Query() query: MonthlyReportFilterDto,
  ) {
    return this.reportsService.getMonthlySummary(ctx, query);
  }

  @Get('monthly/orders')
  listMonthlyOrders(
    @CurrentUser() ctx: TenantContext,
    @Query() query: ListMonthlyReportQueryDto,
  ) {
    return this.reportsService.listMonthlyOrders(ctx, query);
  }

  @Get('product-sales')
  listProductSales(
    @CurrentUser() ctx: TenantContext,
    @Query() query: ListProductSalesQueryDto,
  ) {
    return this.reportsService.listProductSales(ctx, query);
  }

  @Get('external-delivery')
  listExternalDeliveries(
    @CurrentUser() ctx: TenantContext,
    @Query() query: ListGeneralReportQueryDto,
  ) {
    return this.reportsService.listExternalDeliveries(ctx, query);
  }
}
