import {
  Body,
  Controller,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ExternalDeliveriesService } from './external-deliveries.service';
import { CreateExternalDeliveryDto } from './dto/create-external-delivery.dto';
import { UpdateExternalDeliveryDto } from './dto/update-external-delivery.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';

// Admin-only, same as every other write path this session added a role
// guard to (Products/Collections structural edits) — logging what was paid
// to a courier is a business-financial record, not a branch day-to-day
// stock action.
@Roles('admin')
@Controller('orders/:orderId/external-delivery')
export class ExternalDeliveriesController {
  constructor(
    private readonly externalDeliveriesService: ExternalDeliveriesService,
  ) {}

  @Post()
  create(
    @CurrentUser() ctx: TenantContext,
    @Param('orderId', ParseIntPipe) orderId: number,
    @Body() dto: CreateExternalDeliveryDto,
  ) {
    return this.externalDeliveriesService.create(ctx, orderId, dto);
  }

  @Patch()
  update(
    @CurrentUser() ctx: TenantContext,
    @Param('orderId', ParseIntPipe) orderId: number,
    @Body() dto: UpdateExternalDeliveryDto,
  ) {
    return this.externalDeliveriesService.update(ctx, orderId, dto);
  }
}
