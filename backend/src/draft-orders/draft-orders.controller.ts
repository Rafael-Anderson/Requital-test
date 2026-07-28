import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { DraftOrdersService } from './draft-orders.service';
import { CreateDraftOrderDto } from './dto/create-draft-order.dto';
import { UpdateDraftOrderDto } from './dto/update-draft-order.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';

// Admin + order_manager — building an order on a customer's behalf
// (phone/WhatsApp orders) is order-management work, same domain as
// OrdersController's own POST /orders (which order_manager can also hit).
// 'branch' stays excluded, unchanged from before this role was added — no
// task requested branch access to draft orders specifically.
@Roles('admin', 'order_manager')
@Controller('shop/draft-orders')
export class DraftOrdersController {
  constructor(private readonly draftOrdersService: DraftOrdersService) {}

  @Get()
  findAll(@CurrentUser() ctx: TenantContext) {
    return this.draftOrdersService.findAll(ctx);
  }

  @Post()
  create(@CurrentUser() ctx: TenantContext, @Body() dto: CreateDraftOrderDto) {
    return this.draftOrdersService.create(ctx, dto);
  }

  @Get(':id')
  findOne(@CurrentUser() ctx: TenantContext, @Param('id', ParseIntPipe) id: number) {
    return this.draftOrdersService.findOne(ctx, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDraftOrderDto,
  ) {
    return this.draftOrdersService.update(ctx, id, dto);
  }

  @Patch(':id/cancel')
  cancel(@CurrentUser() ctx: TenantContext, @Param('id', ParseIntPipe) id: number) {
    return this.draftOrdersService.cancel(ctx, id);
  }

  @Post(':id/complete')
  complete(@CurrentUser() ctx: TenantContext, @Param('id', ParseIntPipe) id: number) {
    return this.draftOrdersService.complete(ctx, id);
  }

  @Post(':id/send-invoice')
  sendInvoice(@CurrentUser() ctx: TenantContext, @Param('id', ParseIntPipe) id: number) {
    return this.draftOrdersService.sendInvoice(ctx, id);
  }
}
