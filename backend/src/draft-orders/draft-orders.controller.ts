import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { DraftOrdersService } from './draft-orders.service';
import { ValidateDiscountDto } from '../discounts/dto/validate-discount.dto';
import { CreateDraftOrderDto } from './dto/create-draft-order.dto';
import { UpdateDraftOrderDto } from './dto/update-draft-order.dto';
import { PreviewDraftOrderDto } from './dto/preview-draft-order.dto';
import { MarkDraftPaidDto } from './dto/mark-paid.dto';
import { ListDraftOrdersDto } from './dto/list-draft-orders.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';

// Admin + order_manager — building an order on a customer's behalf
// (phone/WhatsApp orders) is order-management work, same domain as
// OrdersController's own POST /orders (which order_manager can also hit).
// 'branch' stays excluded. Every write also asserts the 'orders.create'
// permission at the draft's outlet (a per-outlet branch role can take it away).
@Roles('admin', 'order_manager')
@Controller('shop/draft-orders')
export class DraftOrdersController {
  constructor(private readonly draftOrdersService: DraftOrdersService) {}

  @Get()
  findAll(
    @CurrentUser() ctx: TenantContext,
    @Query() query: ListDraftOrdersDto,
  ) {
    return this.draftOrdersService.findAll(ctx, query);
  }

  // The live bill split for the builder (an unsaved form). Writes nothing.
  @HttpCode(200)
  @Post('preview')
  preview(
    @CurrentUser() ctx: TenantContext,
    @Body() dto: PreviewDraftOrderDto,
  ) {
    return this.draftOrdersService.preview(ctx, dto);
  }

  @Post()
  create(@CurrentUser() ctx: TenantContext, @Body() dto: CreateDraftOrderDto) {
    return this.draftOrdersService.create(ctx, dto);
  }

  @Get(':id')
  findOne(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
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
  cancel(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.draftOrdersService.cancel(ctx, id);
  }

  // Card payment link: creates it (or re-sends the same one) and freezes the
  // priced snapshot. The draft does not become an order until the customer pays.
  @Post(':id/payment-link')
  sendLink(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.draftOrdersService.sendLink(ctx, id);
  }

  @Post(':id/payment-link/cancel')
  cancelLink(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.draftOrdersService.cancelLink(ctx, id);
  }

  @Post(':id/email-invoice')
  emailInvoice(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.draftOrdersService.sendEmail(ctx, id);
  }

  // Cash on delivery / pickup: converts now, payment pending.
  @Post(':id/cod')
  cod(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.draftOrdersService.convertCod(ctx, id);
  }

  @Post(':id/mark-paid')
  markPaid(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: MarkDraftPaidDto,
  ) {
    return this.draftOrdersService.markPaid(ctx, id, dto);
  }

  // Before custom orders: "Mark as paid" with no method. Kept for any caller of
  // the old route; records the method as 'other'.
  @Post(':id/complete')
  complete(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.draftOrdersService.markPaid(ctx, id, { method: 'other' });
  }

  // Before custom orders this converted at once and returned an order link. It
  // now creates the draft's own payment link (no order until payment).
  @Post(':id/send-invoice')
  sendInvoice(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.draftOrdersService.sendLink(ctx, id);
  }
}

// POST /shop/discounts/validate, the admin draft-order builder's live preview.
// It lives here rather than in DiscountsController because pricing the cart's
// lines needs the product resolver, and DiscountsModule cannot import
// ProductsModule (which already imports it). Same URL, same admin-only access.
@Roles('admin')
@Controller('shop/discounts/validate')
export class DiscountValidationController {
  constructor(private readonly draftOrdersService: DraftOrdersService) {}

  @Post()
  validate(
    @CurrentUser() ctx: TenantContext,
    @Body() dto: ValidateDiscountDto,
  ) {
    return this.draftOrdersService.validateDiscount(ctx, dto);
  }
}
