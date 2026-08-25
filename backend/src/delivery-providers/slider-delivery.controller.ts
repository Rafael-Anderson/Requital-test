import {
  Body,
  Controller,
  Delete,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { SliderDeliveryService } from './slider-delivery.service';
import { CreateSliderDeliveryDto } from './dto/create-slider-delivery.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';

// Same role allow-list as every other order-mutation route (PaymentLinkController,
// OrdersController's own status/cancel) — 'viewer' excluded.
@Roles('admin', 'branch', 'order_manager')
@Controller('orders/:orderId/slider-delivery')
export class SliderDeliveryController {
  constructor(private readonly sliderDeliveryService: SliderDeliveryService) {}

  @Post('quote')
  getQuote(
    @CurrentUser() ctx: TenantContext,
    @Param('orderId', ParseIntPipe) orderId: number,
  ) {
    return this.sliderDeliveryService.getQuote(ctx, orderId);
  }

  @Post()
  dispatch(
    @CurrentUser() ctx: TenantContext,
    @Param('orderId', ParseIntPipe) orderId: number,
    @Body() dto: CreateSliderDeliveryDto,
  ) {
    return this.sliderDeliveryService.dispatch(ctx, orderId, dto);
  }

  @Delete()
  cancel(
    @CurrentUser() ctx: TenantContext,
    @Param('orderId', ParseIntPipe) orderId: number,
  ) {
    return this.sliderDeliveryService.cancel(ctx, orderId);
  }
}
