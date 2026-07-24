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
import { UpdateDeliveryFeeDto } from './dto/update-delivery-fee.dto';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  findAll(
    @CurrentUser() ctx: TenantContext,
    @Query() query: ListOrdersQueryDto,
  ) {
    return this.ordersService.findAll(ctx, query);
  }

  @Get(':id')
  findOne(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.ordersService.findOneDetail(ctx, id);
  }

  @Post()
  create(@CurrentUser() ctx: TenantContext, @Body() dto: CreateOrderDto) {
    return this.ordersService.create(ctx, dto);
  }

  @Patch(':id/status')
  updateStatus(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.ordersService.updateStatus(ctx, id, dto);
  }

  @Patch(':id/delivery-fee')
  updateDeliveryFee(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDeliveryFeeDto,
  ) {
    return this.ordersService.updateDeliveryFee(ctx, id, dto);
  }

  @Post(':id/cancel')
  cancel(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.ordersService.cancel(ctx, id);
  }
}
