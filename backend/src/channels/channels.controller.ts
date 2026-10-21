import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';
import { ChannelConnectionsService } from './channel-connections.service';
import { ChannelMappingsService } from './channel-mappings.service';
import { ChannelOrdersService } from './channel-orders.service';
import { ChannelIngestionService } from './channel-ingestion.service';
import { ChannelProviderRegistry } from './channel-provider.registry';
import {
  CreateChannelConnectionDto,
  CreateChannelMappingDto,
  ListChannelOrdersQueryDto,
  RejectChannelOrderDto,
  ResolveUnmappedItemDto,
  SetChannelEnabledDto,
  UpdateChannelConnectionDto,
} from './dto/channels.dto';

// Configuration (connections, mappings, ops) is admin-only. The orders desk is
// also open to branch and order_manager: acceptance has a minutes-long deadline
// and is done by whoever is on shift; every action still checks orders.manage at
// the order's outlet and a branch user only ever sees their own outlet.
@Roles('admin')
@Controller('channels')
export class ChannelsController {
  constructor(
    private readonly connections: ChannelConnectionsService,
    private readonly mappings: ChannelMappingsService,
    private readonly orders: ChannelOrdersService,
    private readonly ingestion: ChannelIngestionService,
    private readonly registry: ChannelProviderRegistry,
  ) {}

  @Get('providers')
  providers() {
    return this.registry.names().map((n) => {
      const p = this.registry.find(n)!;
      return {
        name: n,
        displayName: p.displayName ?? n,
        credentialFields: p.credentialFields ?? [],
        capabilities: p.capabilities,
      };
    });
  }

  // Is the feature on for this shop, and does the shop already have any
  // connection (flag off does not stop orders from a connection that exists).
  // Any role that can reach the orders desk may ask: it is two booleans.
  @Roles('admin', 'branch', 'order_manager')
  @Get('availability')
  availability(@CurrentUser() ctx: TenantContext) {
    return this.connections.availability(ctx);
  }

  @Get('connections')
  listConnections(@CurrentUser() ctx: TenantContext) {
    return this.connections.list(ctx);
  }

  @Post('connections')
  createConnection(
    @CurrentUser() ctx: TenantContext,
    @Body() dto: CreateChannelConnectionDto,
  ) {
    return this.connections.create(ctx, dto);
  }

  @Patch('connections/:id')
  updateConnection(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateChannelConnectionDto,
  ) {
    return this.connections.update(ctx, id, dto);
  }

  @Post('connections/:id/enabled')
  setEnabled(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetChannelEnabledDto,
  ) {
    return this.connections.setEnabled(ctx, id, dto.enabled);
  }

  @Post('connections/:id/test')
  test(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.connections.testConnection(ctx, id);
  }

  @Delete('connections/:id')
  removeConnection(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.connections.remove(ctx, id);
  }

  @Get('mappings')
  listMappings(
    @CurrentUser() ctx: TenantContext,
    @Query('provider') provider?: string,
  ) {
    return this.mappings.list(ctx, provider);
  }

  @Post('mappings')
  createMapping(
    @CurrentUser() ctx: TenantContext,
    @Body() dto: CreateChannelMappingDto,
  ) {
    return this.mappings.create(ctx, dto);
  }

  @Delete('mappings/:id')
  removeMapping(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.mappings.remove(ctx, id);
  }

  @Get('unmapped-items')
  listUnmapped(
    @CurrentUser() ctx: TenantContext,
    @Query('includeResolved') includeResolved?: string,
  ) {
    return this.mappings.listUnmapped(ctx, includeResolved === 'true');
  }

  @Post('unmapped-items/:id/resolve')
  resolveUnmapped(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ResolveUnmappedItemDto,
  ) {
    return this.mappings.resolveUnmapped(ctx, id, dto);
  }

  @Roles('admin', 'branch', 'order_manager')
  @Get('orders')
  listOrders(
    @CurrentUser() ctx: TenantContext,
    @Query() q: ListChannelOrdersQueryDto,
  ) {
    return this.orders.list(ctx, q);
  }

  @Roles('admin', 'branch', 'order_manager')
  @Post('orders/:id/accept')
  accept(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.orders.accept(ctx, id);
  }

  @Roles('admin', 'branch', 'order_manager')
  @Post('orders/:id/reject')
  reject(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RejectChannelOrderDto,
  ) {
    return this.orders.reject(ctx, id, dto);
  }

  // The SLO numbers for this shop (ingestion success %, failure %).
  @Get('stats')
  stats(
    @CurrentUser() ctx: TenantContext,
    @Query('sinceMinutes') sinceMinutes?: string,
  ) {
    const n = Math.min(
      Math.max(parseInt(sinceMinutes ?? '1440', 10) || 1440, 1),
      43200,
    );
    return this.ingestion.stats({ shopId: ctx.shopId, sinceMinutes: n });
  }

  // Replays only the rows named. An empty or all-invalid list is a 400, never
  // "everything": a malformed request must not re-run a shop's whole backlog.
  @Post('inbox/replay')
  replay(@CurrentUser() ctx: TenantContext, @Body() body: { ids?: unknown }) {
    const raw = Array.isArray(body?.ids) ? body.ids : [];
    const ids = raw.filter(
      (i): i is number => Number.isInteger(i) && (i as number) > 0,
    );
    if (raw.length === 0 || ids.length !== raw.length || ids.length > 200) {
      throw new BadRequestException(
        'ids must be a list of 1 to 200 valid inbox ids',
      );
    }
    return this.ingestion.replay(ctx.shopId, ids);
  }
}
