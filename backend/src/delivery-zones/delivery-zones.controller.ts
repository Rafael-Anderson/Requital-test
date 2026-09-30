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
} from '@nestjs/common';
import { DeliveryZonesService } from './delivery-zones.service';
import { CreateDeliveryZoneDto } from './dto/create-delivery-zone.dto';
import { UpdateDeliveryZoneDto } from './dto/update-delivery-zone.dto';
import { SetZoneMappingDto } from './dto/set-zone-mapping.dto';
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

  // Declared before the ':zoneId' routes so "mapping-proposal" is never read as an id.
  @Get('mapping-proposal')
  mappingProposal(
    @CurrentUser() ctx: TenantContext,
    @Param('outletId', ParseIntPipe) outletId: number,
  ) {
    return this.deliveryZonesService.getMappingProposal(ctx, outletId);
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
  @Put(':zoneId/mapping')
  setMapping(
    @CurrentUser() ctx: TenantContext,
    @Param('outletId', ParseIntPipe) outletId: number,
    @Param('zoneId', ParseIntPipe) zoneId: number,
    @Body() dto: SetZoneMappingDto,
  ) {
    return this.deliveryZonesService.setMapping(ctx, outletId, zoneId, dto);
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
