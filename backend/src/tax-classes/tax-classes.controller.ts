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
import { TaxClassesService } from './tax-classes.service';
import { CreateTaxClassDto } from './dto/create-tax-class.dto';
import { UpdateTaxClassDto } from './dto/update-tax-class.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';

// Same tier as Brands: reads open to any authenticated role (the product form
// needs the list to render its picker, and a branch user edits products), every
// write admin-only. A tax rate is a filing decision, not a branch-level one.
//
// Deliberately NOT exposed on /public/:shopSlug — a storefront never needs the
// class list. Once B2 lands, the price the customer sees already has the tax
// resolved into it server-side.
@Controller('tax-classes')
export class TaxClassesController {
  constructor(private readonly taxClassesService: TaxClassesService) {}

  @Get()
  findAll(@CurrentUser() ctx: TenantContext) {
    return this.taxClassesService.findAll(ctx);
  }

  @Get(':id')
  findOne(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.taxClassesService.findOne(ctx, id);
  }

  @Roles('admin')
  @Post()
  create(@CurrentUser() ctx: TenantContext, @Body() dto: CreateTaxClassDto) {
    return this.taxClassesService.create(ctx, dto);
  }

  @Roles('admin')
  @Patch(':id')
  update(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTaxClassDto,
  ) {
    return this.taxClassesService.update(ctx, id, dto);
  }

  @Roles('admin')
  @Delete(':id')
  remove(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.taxClassesService.remove(ctx, id);
  }
}
