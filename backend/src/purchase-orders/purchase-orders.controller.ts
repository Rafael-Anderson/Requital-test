import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { PurchaseOrdersService } from './purchase-orders.service';
import {
  CreatePurchaseOrderDto,
  ListPurchaseOrdersQueryDto,
  ReceivePurchaseOrderDto,
  ReplacePurchaseOrderLinesDto,
  ScanPurchaseOrderLineDto,
  UpdatePurchaseOrderDto,
} from './dto/purchase-order.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';

// admin (every outlet) and branch (own outlet only: the service forces and
// re-checks it, and then the per-outlet permission layer applies on top).
// order_manager and viewer have no purchasing access.
@Roles('admin', 'branch')
@Controller('purchase-orders')
export class PurchaseOrdersController {
  constructor(private readonly purchaseOrders: PurchaseOrdersService) {}

  @Get()
  findAll(
    @CurrentUser() ctx: TenantContext,
    @Query() query: ListPurchaseOrdersQueryDto,
  ) {
    return this.purchaseOrders.findAll(ctx, query);
  }

  @Get(':id')
  findOne(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.purchaseOrders.findOne(ctx, id);
  }

  @Post()
  create(
    @CurrentUser() ctx: TenantContext,
    @Body() dto: CreatePurchaseOrderDto,
  ) {
    return this.purchaseOrders.create(ctx, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePurchaseOrderDto,
  ) {
    return this.purchaseOrders.update(ctx, id, dto);
  }

  @Put(':id/lines')
  replaceLines(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReplacePurchaseOrderLinesDto,
  ) {
    return this.purchaseOrders.replaceLines(ctx, id, dto);
  }

  @Post(':id/send')
  send(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.purchaseOrders.send(ctx, id);
  }

  @Post(':id/cancel')
  cancel(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.purchaseOrders.cancel(ctx, id);
  }

  @Post(':id/receive')
  receive(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReceivePurchaseOrderDto,
  ) {
    return this.purchaseOrders.receive(ctx, id, dto);
  }

  @Post(':id/scan')
  scan(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ScanPurchaseOrderLineDto,
  ) {
    return this.purchaseOrders.resolveScan(ctx, id, dto);
  }
}
