import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { AffiliateService } from './affiliate.service';
import { CreateAffiliateDto } from './dto/create-affiliate.dto';
import { UpdateAffiliateDto } from './dto/update-affiliate.dto';
import { CreateAffiliateCodeDto } from './dto/create-affiliate-code.dto';
import { UpdateAffiliateCodeDto } from './dto/update-affiliate-code.dto';
import { UpdateAffiliateOrderStatusDto } from './dto/update-affiliate-order-status.dto';
import { ListQueryDto } from './dto/list-query.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';

// Admin-only, entirely — same access level as Reports/Customers (business
// analytics + a merchant-facing payout workflow, not something branch staff
// need).
@Roles('admin')
@Controller('affiliates')
export class AffiliateController {
  constructor(private readonly affiliateService: AffiliateService) {}

  @Get('summary')
  getSummary(@CurrentUser() ctx: TenantContext) {
    return this.affiliateService.getSummary(ctx);
  }

  @Get()
  findAllAffiliates(
    @CurrentUser() ctx: TenantContext,
    @Query() query: ListQueryDto,
  ) {
    return this.affiliateService.findAllAffiliates(ctx, query);
  }

  @Post()
  createAffiliate(
    @CurrentUser() ctx: TenantContext,
    @Body() dto: CreateAffiliateDto,
  ) {
    return this.affiliateService.createAffiliate(ctx, dto);
  }

  @Patch(':id')
  updateAffiliate(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAffiliateDto,
  ) {
    return this.affiliateService.updateAffiliate(ctx, id, dto);
  }

  @Get('codes')
  findAllCodes(
    @CurrentUser() ctx: TenantContext,
    @Query() query: ListQueryDto,
  ) {
    return this.affiliateService.findAllCodes(ctx, query);
  }

  @Post('codes')
  createCode(
    @CurrentUser() ctx: TenantContext,
    @Body() dto: CreateAffiliateCodeDto,
  ) {
    return this.affiliateService.createCode(ctx, dto);
  }

  @Patch('codes/:id')
  updateCode(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAffiliateCodeDto,
  ) {
    return this.affiliateService.updateCode(ctx, id, dto);
  }

  @Get('orders')
  findAllOrders(
    @CurrentUser() ctx: TenantContext,
    @Query() query: ListQueryDto,
  ) {
    return this.affiliateService.findAllOrders(ctx, query);
  }

  @Patch('orders/:id/status')
  updateOrderStatus(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAffiliateOrderStatusDto,
  ) {
    return this.affiliateService.updateOrderStatus(ctx, id, dto);
  }
}
