import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';
import { MapsHealthService } from './maps-health.service';
import { ReportMapsErrorDto } from './dto/report-maps-error.dto';
import { ResolveMapsErrorDto } from './dto/resolve-maps-error.dto';

// The storefront reports a Google Maps failure here (shopper origin).
@Controller('public/:shopSlug')
export class PublicMapsHealthController {
  constructor(private readonly service: MapsHealthService) {}

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Public()
  @Post('maps-error')
  @HttpCode(204)
  async report(
    @Param('shopSlug') shopSlug: string,
    @Body() dto: ReportMapsErrorDto,
  ) {
    await this.service.report(shopSlug, dto);
  }
}

// What the merchant sees (never rendered to shoppers).
@Roles('admin')
@Controller('shop')
export class MapsHealthController {
  constructor(private readonly service: MapsHealthService) {}

  @Get('maps-health')
  list(@CurrentUser() ctx: TenantContext) {
    return this.service.list(ctx.shopId);
  }

  @Post('maps-health/resolve')
  @HttpCode(200)
  resolve(
    @CurrentUser() ctx: TenantContext,
    @Body() dto: ResolveMapsErrorDto,
  ) {
    return this.service.resolve(ctx, dto.code, dto.host);
  }
}
