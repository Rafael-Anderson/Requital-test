import {
  BadGatewayException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import { trimDecimal } from '../database/decimal.util';
import type { TenantContext } from '../common/tenant-context';
import { resolveOutletFilter } from '../common/outlet-scope';
import { minorToDecimal } from '../drivers/cash';
import { createLogger } from '../common/logging/logger';
import { BranchRolesService } from '../branch-roles/branch-roles.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import type { ChannelorderRow } from '../db/types';
import { ChannelConnectionsService } from './channel-connections.service';
import { ChannelIngestionService } from './channel-ingestion.service';
import { ChannelProviderRegistry } from './channel-provider.registry';
import type { CanonicalChannelOrder } from './channel.types';
import type {
  ListChannelOrdersQueryDto,
  RejectChannelOrderDto,
} from './dto/channels.dto';

const logger = createLogger('ChannelOrders');

// The merchant's view of marketplace orders, and the two things they can do to
// one: accept it or reject it. Both go to the marketplace first and only then
// change our state, by CAS, so a failed call changes nothing and a repeat is safe.
@Injectable()
export class ChannelOrdersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly branchRoles: BranchRolesService,
    private readonly audit: AuditLogService,
    private readonly registry: ChannelProviderRegistry,
    private readonly connections: ChannelConnectionsService,
    private readonly ingestion: ChannelIngestionService,
  ) {}

  async list(ctx: TenantContext, q: ListChannelOrdersQueryDto) {
    const outletId = resolveOutletFilter(ctx, q.outletId);
    // A list with a resolved outlet is a single-outlet read: the restrict-only
    // branch role must apply (the unresolved admin list skips it by design).
    if (outletId !== undefined) {
      await this.branchRoles.assertPermission(ctx, outletId, 'orders.view');
    }
    const page = q.page ?? 1;
    const pageSize = Math.min(q.pageSize ?? 20, 100);
    const where = ['co.shopId = ?'];
    const params: (string | number)[] = [ctx.shopId];
    if (outletId !== undefined) {
      where.push('co.outletId = ?');
      params.push(outletId);
    }
    if (q.state) {
      where.push('co.state = ?');
      params.push(q.state);
    }
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT co.*, o.shopOrderNumber, o.total AS orderTotal, o.status AS orderStatus
         FROM channelorder co LEFT JOIN \`order\` o ON o.id = co.orderId AND o.shopId = co.shopId
        WHERE ${where.join(' AND ')}
        ORDER BY co.receivedAt DESC, co.id DESC
        LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize],
    );
    const [{ n }] = await this.db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM channelorder co WHERE ${where.join(' AND ')}`,
      params,
    );
    return {
      data: rows.map((r) => this.view(r)),
      page,
      pageSize,
      total: Number(n),
    };
  }

  // Never returns the canonical snapshot as stored: only the item names and
  // quantities the merchant needs to decide, and no customer details.
  private view(r: RowDataPacket) {
    const canonical = r.canonical as CanonicalChannelOrder | null;
    return {
      id: r.id as number,
      outletId: r.outletId as number,
      provider: r.provider as string,
      externalOrderId: r.externalOrderId as string,
      displayId: r.displayId as string | null,
      state: r.state as string,
      externalStatus: r.externalStatus as string,
      acceptBy: r.acceptBy as Date | null,
      scheduledFor: r.scheduledFor as Date | null,
      orderId: r.orderId as number | null,
      shopOrderNumber: r.shopOrderNumber as number | null,
      orderStatus: r.orderStatus as string | null,
      currency: r.currency as string,
      total: r.orderTotal
        ? trimDecimal(r.orderTotal as string)
        : canonical
          ? minorToDecimal(canonical.totals.totalMinor, r.currency as string)
          : null,
      // NULL = the marketplace did not say.
      commissionAmount: r.commissionAmount ? trimDecimal(r.commissionAmount as string) : null,
      priceMismatch: (r.priceMismatch as unknown[] | null) ?? null,
      waitingItems: canonical
        ? canonical.lines.map((l) => ({
            externalItemId: l.externalItemId,
            name: l.name,
            quantity: l.quantity,
          }))
        : null,
      lastError: r.lastError as string | null,
      receivedAt: r.receivedAt as Date,
    };
  }

  // Branch users are pinned to their outlet: another outlet's row is a 404, and
  // the explicit comparison (not a spread into the WHERE) is the guard.
  private async load(ctx: TenantContext, id: number): Promise<ChannelorderRow> {
    const rows = await this.db.query<(ChannelorderRow & RowDataPacket)[]>(
      `SELECT * FROM channelorder WHERE id = ? AND shopId = ?`,
      [id, ctx.shopId],
    );
    const co = rows[0];
    if (!co || (ctx.role === 'branch' && co.outletId !== ctx.outletId)) {
      throw new NotFoundException('Marketplace order not found');
    }
    await this.branchRoles.assertPermission(ctx, co.outletId, 'orders.manage');
    return co;
  }

  private async one(ctx: TenantContext, id: number) {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT co.*, o.shopOrderNumber, o.total AS orderTotal, o.status AS orderStatus
         FROM channelorder co LEFT JOIN \`order\` o ON o.id = co.orderId AND o.shopId = co.shopId
        WHERE co.id = ? AND co.shopId = ?`,
      [id, ctx.shopId],
    );
    return this.view(rows[0]);
  }

  async accept(ctx: TenantContext, id: number) {
    const co = await this.load(ctx, id);
    if (co.state === 'accepted') return this.one(ctx, id);
    if (co.state === 'needs_mapping') {
      throw new ConflictException('Map this order’s items before accepting it');
    }
    if (co.state !== 'pending_acceptance') {
      throw new ConflictException('This order is already closed');
    }
    await this.callProvider(co, 'accept', (provider, conn) =>
      provider.acceptOrder!(conn, co.externalOrderId),
    );
    await this.ingestion.markAcceptedExternally(co, 'accepted', ctx);
    await this.audit.logCtx(ctx, {
      action: 'channel_order.accepted',
      entityType: 'channelorder',
      entityId: co.id,
      after: { provider: co.provider, externalOrderId: co.externalOrderId },
    });
    return this.one(ctx, id);
  }

  async reject(ctx: TenantContext, id: number, dto: RejectChannelOrderDto) {
    const co = await this.load(ctx, id);
    if (co.state === 'rejected') return this.one(ctx, id);
    if (co.state !== 'pending_acceptance' && co.state !== 'needs_mapping') {
      throw new ConflictException('This order can no longer be rejected here');
    }
    const reason = dto.reason?.trim() || 'other';
    await this.callProvider(co, 'reject', (provider, conn) =>
      provider.rejectOrder!(conn, co.externalOrderId, reason),
    );
    await this.ingestion.closeUpstream(co, 'rejected', 'rejected', ctx);
    await this.audit.logCtx(ctx, {
      action: 'channel_order.rejected',
      entityType: 'channelorder',
      entityId: co.id,
      after: { provider: co.provider, externalOrderId: co.externalOrderId, reason },
    });
    return this.one(ctx, id);
  }

  // A provider that cannot accept/reject over an API (capability off) is a local
  // state change only. A provider that can, and fails, changes NOTHING here.
  private async callProvider(
    co: ChannelorderRow,
    what: 'accept' | 'reject',
    call: (
      provider: NonNullable<ReturnType<ChannelProviderRegistry['find']>>,
      conn: ReturnType<ChannelConnectionsService['bind']>,
    ) => Promise<{ ok: boolean; message?: string }>,
  ): Promise<void> {
    const provider = this.registry.find(co.provider);
    const method = what === 'accept' ? provider?.acceptOrder : provider?.rejectOrder;
    if (!provider || !provider.capabilities.acceptReject || !method) return;
    const connRow = await this.connections.findById(co.connectionId);
    if (!connRow || connRow.shopId !== co.shopId) {
      throw new BadGatewayException('The marketplace connection is no longer available');
    }
    try {
      const result = await call(provider, this.connections.bind(connRow));
      if (!result.ok) {
        throw new Error(result.message ?? `${what} was refused`);
      }
    } catch (e) {
      logger.warn(`marketplace ${what} failed`, {
        channelOrderId: co.id,
        shopId: co.shopId,
        provider: co.provider,
        error: e instanceof Error ? e.message.slice(0, 200) : String(e),
      });
      throw new BadGatewayException(
        `The marketplace did not accept the ${what}. Nothing was changed; try again.`,
      );
    }
  }
}
