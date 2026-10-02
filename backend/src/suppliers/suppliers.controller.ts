import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { SuppliersService } from './suppliers.service';
import {
  CreateSupplierContactDto,
  CreateSupplierDto,
  UpdateSupplierContactDto,
  UpdateSupplierDto,
  UpsertSupplierItemDto,
} from './dto/supplier.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';

// Writes are admin-only: a supplier record carries payment terms, costs and
// contact details, and changing it changes what future purchase orders default
// to. Reads are admin + branch: a branch user raising a purchase order for their
// own outlet has to pick a supplier. order_manager (orders only) and viewer
// (read-only reporting) have no purchasing access, so they get none here.
@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Roles('admin', 'branch')
  @Get()
  findAll(@CurrentUser() ctx: TenantContext, @Query('status') status?: string) {
    return this.suppliers.findAll(ctx, status);
  }

  // Declared before ':id' so "suggestions" is never parsed as an id.
  @Roles('admin')
  @Get('suggestions/free-text')
  suggest(@CurrentUser() ctx: TenantContext) {
    return this.suppliers.suggestFromFreeText(ctx);
  }

  @Roles('admin', 'branch')
  @Get(':id')
  findOne(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.suppliers.findOne(ctx, id);
  }

  @Roles('admin')
  @Post()
  create(@CurrentUser() ctx: TenantContext, @Body() dto: CreateSupplierDto) {
    return this.suppliers.create(ctx, dto);
  }

  @Roles('admin')
  @Patch(':id')
  update(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateSupplierDto,
  ) {
    return this.suppliers.update(ctx, id, dto);
  }

  @Roles('admin')
  @Delete(':id')
  remove(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.suppliers.remove(ctx, id);
  }

  @Roles('admin')
  @Post(':id/contacts')
  addContact(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateSupplierContactDto,
  ) {
    return this.suppliers.addContact(ctx, id, dto);
  }

  @Roles('admin')
  @Patch(':id/contacts/:contactId')
  updateContact(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Param('contactId', ParseIntPipe) contactId: number,
    @Body() dto: UpdateSupplierContactDto,
  ) {
    return this.suppliers.updateContact(ctx, id, contactId, dto);
  }

  @Roles('admin')
  @Delete(':id/contacts/:contactId')
  removeContact(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Param('contactId', ParseIntPipe) contactId: number,
  ) {
    return this.suppliers.removeContact(ctx, id, contactId);
  }

  @Roles('admin')
  @Put(':id/items/:ingredientId')
  upsertItem(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Param('ingredientId', ParseIntPipe) ingredientId: number,
    @Body() dto: UpsertSupplierItemDto,
  ) {
    return this.suppliers.upsertItem(ctx, id, ingredientId, dto);
  }

  @Roles('admin')
  @Delete(':id/items/:ingredientId')
  removeItem(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Param('ingredientId', ParseIntPipe) ingredientId: number,
  ) {
    return this.suppliers.removeItem(ctx, id, ingredientId);
  }
}
