import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { DeliveryRunsService } from './delivery-runs.service';
import { DriverLinksService } from './driver-links.service';
import {
  AddStopsDto,
  CashReconciliationQueryDto,
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
  constructor(
    private readonly runs: DeliveryRunsService,
    private readonly links: DriverLinksService,
  ) {}

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
    @Query() query: CashReconciliationQueryDto,
  ) {
    return this.runs.reconciliation(ctx, query);
  }

  @Get(':id/sheet')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  sheet(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.runs.renderSheet(ctx, id);
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
    // The response carries `issuedLink`: the only time the secret URL is shown.
    return this.links.dispatchWithLink(ctx, id);
  }

  @Post(':id/link')
  async issueLink(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const { url, expiresAt } = await this.links.issue(ctx, id);
    return { url, expiresAt };
  }

  @Delete(':id/link')
  revokeLink(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.links.revoke(ctx, id);
  }

  @Post(':id/link/send')
  sendLink(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.links.sendWhatsApp(ctx, id);
  }

  @Post(':id/cancel')
  cancel(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.runs.cancel(ctx, id);
  }
}
