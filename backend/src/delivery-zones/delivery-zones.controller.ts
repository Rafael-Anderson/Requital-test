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
import { DeliveryZonesService } from './delivery-zones.service';
import { CreateDeliveryZoneDto } from './dto/create-delivery-zone.dto';
import { UpdateDeliveryZoneDto } from './dto/update-delivery-zone.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';

@Controller('outlets/:outletId/delivery-zones')
export class DeliveryZonesController {
  constructor(private readonly deliveryZonesService: DeliveryZonesService) {}

  @Get()
  findAll(
    @CurrentUser() ctx: TenantContext,
    @Param('outletId', ParseIntPipe) outletId: number,
  ) {
    return this.deliveryZonesService.findAll(ctx, outletId);
  }

  @Roles('admin')
  @Post()
  create(
    @CurrentUser() ctx: TenantContext,
    @Param('outletId', ParseIntPipe) outletId: number,
    @Body() dto: CreateDeliveryZoneDto,
  ) {
    return this.deliveryZonesService.create(ctx, outletId, dto);
  }

  @Roles('admin')
  @Patch(':zoneId')
  update(
    @CurrentUser() ctx: TenantContext,
    @Param('outletId', ParseIntPipe) outletId: number,
    @Param('zoneId', ParseIntPipe) zoneId: number,
    @Body() dto: UpdateDeliveryZoneDto,
  ) {
    return this.deliveryZonesService.update(ctx, outletId, zoneId, dto);
  }

  @Roles('admin')
  @Delete(':zoneId')
  remove(
    @CurrentUser() ctx: TenantContext,
    @Param('outletId', ParseIntPipe) outletId: number,
    @Param('zoneId', ParseIntPipe) zoneId: number,
  ) {
    return this.deliveryZonesService.remove(ctx, outletId, zoneId);
  }
}
