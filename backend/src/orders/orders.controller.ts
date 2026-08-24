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
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { BulkUpdateOrderStatusDto } from './dto/bulk-update-order-status.dto';
import { CreateOrderNoteDto } from './dto/create-order-note.dto';
import { UpdateOrderItemsDto } from './dto/update-order-items.dto';
import { UpdateDeliveryFeeDto } from './dto/update-delivery-fee.dto';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';

// No class-level @Roles — every role (including the read-only 'viewer')
// can hit this controller, but mutating routes below are explicitly
// restricted to the roles that are actually allowed to change an order
// ('viewer' excluded from all of them). Explicit per-route rather than
// relying on "no decorator = open", now that a read-only role exists.
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Roles('admin', 'branch', 'order_manager', 'viewer')
  @Get()
  findAll(
    @CurrentUser() ctx: TenantContext,
    @Query() query: ListOrdersQueryDto,
  ) {
    return this.ordersService.findAll(ctx, query);
  }

  @Roles('admin', 'branch', 'order_manager', 'viewer')
  @Get(':id')
  findOne(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.ordersService.findOneDetail(ctx, id);
  }

  // Same read access as the detail fetch above — the timeline is part of
  // viewing an order, not a separate permission tier.
  @Roles('admin', 'branch', 'order_manager', 'viewer')
  @Get(':id/history')
  getHistory(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.ordersService.getHistory(ctx, id);
  }

  @Roles('admin', 'branch', 'order_manager')
  @Post()
  create(@CurrentUser() ctx: TenantContext, @Body() dto: CreateOrderDto) {
    return this.ordersService.create(ctx, dto);
  }

  @Roles('admin', 'branch', 'order_manager')
  @Patch(':id/status')
  updateStatus(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.ordersService.updateStatus(ctx, id, dto);
  }

  @Roles('admin', 'branch', 'order_manager')
  @Patch('bulk-status')
  bulkUpdateStatus(
    @CurrentUser() ctx: TenantContext,
    @Body() dto: BulkUpdateOrderStatusDto,
  ) {
    return this.ordersService.bulkUpdateStatus(ctx, dto);
  }

  @Roles('admin', 'branch', 'order_manager')
  @Patch(':id/items')
  updateItems(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateOrderItemsDto,
  ) {
    return this.ordersService.updateItems(ctx, id, dto);
  }

  @Roles('admin', 'branch', 'order_manager')
  @Patch(':id/delivery-fee')
  updateDeliveryFee(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDeliveryFeeDto,
  ) {
    return this.ordersService.updateDeliveryFee(ctx, id, dto);
  }

  @Roles('admin', 'branch', 'order_manager')
  @Post(':id/cancel')
  cancel(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.ordersService.cancel(ctx, id);
  }

  @Roles('admin', 'branch', 'order_manager')
  @Post(':id/collect-cash')
  collectCash(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.ordersService.collectCash(ctx, id);
  }

  // Staff-only — 'viewer' can still read notes (they come back as part of
  // GET :id, which viewer already has access to), just can't add one.
  @Roles('admin', 'branch', 'order_manager')
  @Post(':id/notes')
  addNote(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateOrderNoteDto,
  ) {
    return this.ordersService.addNote(ctx, id, dto);
  }
}
