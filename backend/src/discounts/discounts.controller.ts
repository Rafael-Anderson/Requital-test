import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { DiscountsService } from './discounts.service';
import { CreateDiscountDto } from './dto/create-discount.dto';
import { UpdateDiscountDto } from './dto/update-discount.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';

// Admin-only CRUD, same access level as Bio Links/Theme. The storefront's
// own promo-code validation goes through PublicController's sibling route
// (POST /public/:shopSlug/discounts/validate) instead. The admin draft-order
// builder's POST /shop/discounts/validate is served by DraftOrders'
// DiscountValidationController (it needs the product resolver).
@Roles('admin')
@Controller('shop/discounts')
export class DiscountsController {
  constructor(private readonly discountsService: DiscountsService) {}

  @Get()
  findAll(@CurrentUser() ctx: TenantContext) {
    return this.discountsService.findAll(ctx);
  }

  @Post()
  create(@CurrentUser() ctx: TenantContext, @Body() dto: CreateDiscountDto) {
    return this.discountsService.create(ctx, dto);
  }

  @Get(':id')
  findOne(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.discountsService.findOne(ctx, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDiscountDto,
  ) {
    return this.discountsService.update(ctx, id, dto);
  }

  @Delete(':id')
  remove(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.discountsService.remove(ctx, id);
  }
}
