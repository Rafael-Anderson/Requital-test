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
import { DeliveryRunsService } from './delivery-runs.service';
import {
  AddStopsDto,
  CreateDeliveryRunDto,
  ListDeliveryRunsQueryDto,
  ReadyOrdersQueryDto,
  ReorderStopsDto,
  UpdateDeliveryRunDto,
} from './dto/delivery-run.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';

@Roles('admin', 'branch')
@Controller('delivery-runs')
export class DeliveryRunsController {
  constructor(private readonly runs: DeliveryRunsService) {}

  @Get()
  findAll(
    @CurrentUser() ctx: TenantContext,
    @Query() query: ListDeliveryRunsQueryDto,
  ) {
    return this.runs.findAll(ctx, query);
  }

  // Declared before ':id' so these literal segments are not read as an id.
  @Get('ready-orders')
  readyOrders(
    @CurrentUser() ctx: TenantContext,
    @Query() query: ReadyOrdersQueryDto,
  ) {
    return this.runs.readyOrders(ctx, query);
  }

  @Get('cash-reconciliation')
  reconciliation(
    @CurrentUser() ctx: TenantContext,
    @Query()
    query: { outletId?: string; driverId?: string; from?: string; to?: string },
  ) {
    return this.runs.reconciliation(ctx, {
      outletId: query.outletId
        ? Number(query.outletId) || undefined
        : undefined,
      driverId: query.driverId
        ? Number(query.driverId) || undefined
        : undefined,
      from: query.from,
      to: query.to,
    });
  }

  @Get(':id')
  findOne(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.runs.findOne(ctx, id);
  }

  @Post()
  create(@CurrentUser() ctx: TenantContext, @Body() dto: CreateDeliveryRunDto) {
    return this.runs.create(ctx, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDeliveryRunDto,
  ) {
    return this.runs.update(ctx, id, dto);
  }

  @Post(':id/stops')
  addStops(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AddStopsDto,
  ) {
    return this.runs.addStops(ctx, id, dto);
  }

  @Put(':id/stops/order')
  reorder(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReorderStopsDto,
  ) {
    return this.runs.reorder(ctx, id, dto);
  }

  @Delete(':id/stops/:stopId')
  removeStop(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Param('stopId', ParseIntPipe) stopId: number,
  ) {
    return this.runs.removeStop(ctx, id, stopId);
  }

  @Post(':id/dispatch')
  dispatch(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.runs.dispatch(ctx, id);
  }

  @Post(':id/cancel')
  cancel(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.runs.cancel(ctx, id);
  }
}
