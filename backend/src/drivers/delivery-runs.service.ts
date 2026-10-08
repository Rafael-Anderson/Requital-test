import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import type { QueryParam } from '../database/database.service';
import { buildSetClause } from '../database/update.util';
import { isDuplicateKeyError } from '../database/mysql-errors';
import type { DeliveryrunRow } from '../db/types';
import type { TenantContext } from '../common/tenant-context';
import { resolveOutletFilter } from '../common/outlet-scope';
import { BranchRolesService } from '../branch-roles/branch-roles.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { OrdersService } from '../orders/orders.service';
import { trimDecimal } from '../database/decimal.util';
import { createLogger } from '../common/logging/logger';
import { decimalToMinor, minorToDecimal } from './cash';
import { completeRunIfDone, connExec } from './run-lifecycle';
import {
  AddStopsDto,
  CreateDeliveryRunDto,
  ListDeliveryRunsQueryDto,
  MAX_STOPS_PER_RUN,
  ReadyOrdersQueryDto,
  ReorderStopsDto,
  UpdateDeliveryRunDto,
} from './dto/delivery-run.dto';

const logger = createLogger('DeliveryRunsService');

// An order can ride a run while it is being prepared or once it is already out
// (staff moved it by hand, or a previous attempt failed). 'pending'/'confirmed'
// orders are not ready to leave; 'delivered'/'cancelled' are over.
export const RUNNABLE_ORDER_STATUSES = ['preparing', 'out_for_delivery'];
const LIVE_RUN_STATUSES = ['draft', 'dispatched', 'in_progress'];

export type OrderIneligibility =
  | 'not_found'
  | 'not_delivery'
  | 'bad_status'
  | 'external_courier'
  | 'already_delivered'
  | 'already_on_a_run';

type RunRow = DeliveryrunRow & RowDataPacket;

// Cash totals in integer minor units per currency. Never summed across
// currencies and never through floats.
interface CashBucket {
  expected: number;
  collected: number;
  pending: number;
  discrepancies: number;
}

@Injectable()
export class DeliveryRunsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly branchRoles: BranchRolesService,
    private readonly audit: AuditLogService,
    private readonly orders: OrdersService,
  ) {}

  // ---------------------------------------------------------------- reads

  async findAll(ctx: TenantContext, query: ListDeliveryRunsQueryDto) {
    const outletId = resolveOutletFilter(ctx, query.outletId);
    if (outletId !== undefined) {
      await this.branchRoles.assertPermission(ctx, outletId, 'deliveries.view');
    }
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const conditions = ['r.shopId = ?'];
    const params: QueryParam[] = [ctx.shopId];
    if (outletId !== undefined) {
      conditions.push('r.outletId = ?');
      params.push(outletId);
    }
    if (query.status) {
      conditions.push('r.status = ?');
      params.push(query.status);
    }
    if (query.driverId) {
      conditions.push('r.driverId = ?');
      params.push(query.driverId);
    }
    const where = conditions.join(' AND ');
    const [rows, total] = await Promise.all([
      this.db.query<RowDataPacket[]>(
        `SELECT r.id, r.outletId, r.driverId, r.status, DATE_FORMAT(r.runDate, '%Y-%m-%d') AS runDate,
                r.notes, r.proofRequirement, r.dispatchedAt, r.completedAt, r.cancelledAt, r.createdAt,
                d.name AS driverName,
                (SELECT COUNT(*) FROM deliveryrunstop s WHERE s.runId = r.id) AS stopCount,
                (SELECT COUNT(*) FROM deliveryrunstop s WHERE s.runId = r.id AND s.status = 'delivered') AS deliveredCount,
                (SELECT COUNT(*) FROM deliveryrunstop s WHERE s.runId = r.id AND s.status = 'failed') AS failedCount,
                (SELECT COUNT(*) FROM deliveryrunstop s WHERE s.runId = r.id AND s.cashDiscrepancy = 1) AS discrepancyCount
           FROM deliveryrun r JOIN driver d ON d.id = r.driverId AND d.shopId = r.shopId
          WHERE ${where}
          ORDER BY r.createdAt DESC, r.id DESC
          LIMIT ? OFFSET ?`,
        [...params, pageSize, (page - 1) * pageSize],
      ),
      this.db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM deliveryrun r WHERE ${where}`,
        params,
      ),
    ]);
    return {
      data: rows.map((r) => ({
        ...r,
        stopCount: Number(r.stopCount),
        deliveredCount: Number(r.deliveredCount),
        failedCount: Number(r.failedCount),
        discrepancyCount: Number(r.discrepancyCount),
      })),
      page,
      pageSize,
      total: Number(total[0].c),
    };
  }

  // The scoped lookup every by-id operation goes through. A branch user asking
  // for another outlet's run gets a 404; the permission is checked against the
  // FETCHED row's own outlet.
  async loadRun(
    ctx: TenantContext,
    id: number,
    permission: 'deliveries.view' | 'deliveries.manage',
  ): Promise<DeliveryrunRow> {
    const outletId = resolveOutletFilter(ctx);
    const conditions = ['id = ?', 'shopId = ?'];
    const params: QueryParam[] = [id, ctx.shopId];
    if (outletId !== undefined) {
      conditions.push('outletId = ?');
      params.push(outletId);
    }
    const rows = await this.db.query<RunRow[]>(
      `SELECT *, DATE_FORMAT(runDate, '%Y-%m-%d') AS runDate FROM deliveryrun WHERE ${conditions.join(' AND ')}`,
      params,
    );
    if (rows.length === 0) throw new NotFoundException(`Run ${id} not found`);
    await this.branchRoles.assertPermission(ctx, rows[0].outletId, permission);
    return rows[0];
  }

  async findOne(ctx: TenantContext, id: number) {
    const run = await this.loadRun(ctx, id, 'deliveries.view');
    const [driverRows, stops, links] = await Promise.all([
      this.db.query<RowDataPacket[]>(
        `SELECT id, name, phone, active FROM driver WHERE id = ? AND shopId = ?`,
        [run.driverId, ctx.shopId],
      ),
      this.loadStopsForStaff(ctx.shopId, run.id),
      this.db.query<RowDataPacket[]>(
        `SELECT expiresAt, lastUsedAt, createdAt FROM deliveryrunlink
          WHERE runId = ? AND shopId = ? AND revokedAt IS NULL AND expiresAt > NOW(3)
          ORDER BY id DESC LIMIT 1`,
        [run.id, ctx.shopId],
      ),
    ]);
    return {
      id: run.id,
      outletId: run.outletId,
      status: run.status,
      runDate: run.runDate,
      notes: run.notes,
      proofRequirement: run.proofRequirement,
      dispatchedAt: run.dispatchedAt,
      completedAt: run.completedAt,
      cancelledAt: run.cancelledAt,
      createdAt: run.createdAt,
      driver: driverRows[0] ?? null,
      stops,
      // Whether a live link exists. The secret itself is never retrievable:
      // only its hash is stored, so staff can re-issue but not re-read.
      link: links[0]
        ? {
            expiresAt: links[0].expiresAt as Date,
            lastUsedAt: links[0].lastUsedAt as Date | null,
          }
        : null,
      cash: this.summariseCash(stops),
    };
  }

  private async loadStopsForStaff(shopId: number, runId: number) {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT s.id, s.position, s.status, s.failureReason, s.deliveredAt, s.failedAt,
              s.proofType, s.proofPhotoUrl, s.codExpected, s.cashCollectedAmount, s.cashCurrency, s.cashDiscrepancy,
              s.otpSentAt, s.otpSendCount,
              o.id AS orderId, o.shopOrderNumber, o.customerName, o.customerPhone, o.customerAddress,
              o.area, o.deliveryNotes, o.deliveryTimeSlot, o.status AS orderStatus,
              o.paymentMethod, o.paymentStatus, o.total AS orderTotal, o.currency AS orderCurrency,
              o.cashCollectedAt, rg.nameEn AS regionName
         FROM deliveryrunstop s
         JOIN \`order\` o ON o.id = s.orderId AND o.shopId = s.shopId
         LEFT JOIN region rg ON rg.id = o.regionId
        WHERE s.runId = ? AND s.shopId = ?
        ORDER BY s.position ASC, s.id ASC`,
      [runId, shopId],
    );
    return rows.map((r) => ({
      id: r.id as number,
      position: r.position as number,
      status: r.status as string,
      failureReason: r.failureReason as string | null,
      deliveredAt: r.deliveredAt as Date | null,
      failedAt: r.failedAt as Date | null,
      proofType: r.proofType as string | null,
      // Staff only. The driver's own view never carries this.
      proofPhotoUrl: r.proofPhotoUrl as string | null,
      otpSentAt: r.otpSentAt as Date | null,
      otpSendCount: r.otpSendCount as number,
      cod: r.paymentMethod === 'cash_on_delivery',
      codExpected: trimDecimal(r.codExpected as string | null),
      cashCollectedAmount: trimDecimal(r.cashCollectedAmount as string | null),
      cashCurrency: r.cashCurrency as string | null,
      cashDiscrepancy: Boolean(r.cashDiscrepancy),
      order: {
        id: r.orderId as number,
        shopOrderNumber: r.shopOrderNumber as number,
        customerName: r.customerName as string,
        customerPhone: r.customerPhone as string,
        customerAddress: r.customerAddress as string,
        area: r.area as string | null,
        regionName: r.regionName as string | null,
        deliveryNotes: r.deliveryNotes as string | null,
        deliveryTimeSlot: r.deliveryTimeSlot as string | null,
        status: r.orderStatus as string,
        paymentMethod: r.paymentMethod as string | null,
        paymentStatus: r.paymentStatus as string,
        total: trimDecimal(r.orderTotal as string),
        currency: r.orderCurrency as string,
        cashCollectedAt: r.cashCollectedAt as Date | null,
      },
    }));
  }

  // Expected vs collected per currency, in integer minor units (see CashBucket).
  // `expected` is what the order totalled WHEN the driver delivered it
  // (codExpected, frozen on the stop); `pending` is the live total of COD stops
  // not delivered yet.
  private summariseCash(
    stops: Awaited<ReturnType<DeliveryRunsService['loadStopsForStaff']>>,
  ) {
    const byCurrency = new Map<string, CashBucket>();
    const bucket = (c: string) => {
      let b = byCurrency.get(c);
      if (!b) {
        b = { expected: 0, collected: 0, pending: 0, discrepancies: 0 };
        byCurrency.set(c, b);
      }
      return b;
    };
    for (const s of stops) {
      if (!s.cod) continue;
      const currency = s.order.currency;
      if (s.status === 'delivered') {
        const b = bucket(s.cashCurrency ?? currency);
        b.expected +=
          decimalToMinor(s.codExpected, s.cashCurrency ?? currency) ?? 0;
        b.collected +=
          decimalToMinor(s.cashCollectedAmount, s.cashCurrency ?? currency) ??
          0;
        if (s.cashDiscrepancy) b.discrepancies += 1;
      } else if (s.status === 'pending' && s.order.status !== 'cancelled') {
        bucket(currency).pending +=
          decimalToMinor(s.order.total, currency) ?? 0;
      }
    }
    return [...byCurrency.entries()].map(([currency, b]) => ({
      currency,
      expected: minorToDecimal(b.expected, currency),
      collected: minorToDecimal(b.collected, currency),
      difference: minorToDecimal(b.collected - b.expected, currency),
      pending: minorToDecimal(b.pending, currency),
      discrepancies: b.discrepancies,
    }));
  }

  // Per driver per run, for a date window: what each driver should hand in vs
  // what they say they collected. Delivered COD stops only (pending cash is not
  // owed yet). Integer minor units per currency.
  async reconciliation(
    ctx: TenantContext,
    query: { outletId?: number; driverId?: number; from?: string; to?: string },
  ) {
    const outletId = resolveOutletFilter(ctx, query.outletId);
    if (outletId !== undefined) {
      await this.branchRoles.assertPermission(ctx, outletId, 'deliveries.view');
    }
    const conditions = [
      'r.shopId = ?',
      "s.status = 'delivered'",
      "o.paymentMethod = 'cash_on_delivery'",
    ];
    const params: QueryParam[] = [ctx.shopId];
    if (outletId !== undefined) {
      conditions.push('r.outletId = ?');
      params.push(outletId);
    }
    if (query.driverId) {
      conditions.push('r.driverId = ?');
      params.push(query.driverId);
    }
    if (query.from) {
      conditions.push('s.deliveredAt >= ?');
      params.push(new Date(query.from));
    }
    if (query.to) {
      conditions.push('s.deliveredAt <= ?');
      params.push(new Date(query.to));
    }
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT r.id AS runId, r.driverId, d.name AS driverName, DATE_FORMAT(r.runDate, '%Y-%m-%d') AS runDate,
              s.id AS stopId, s.codExpected, s.cashCollectedAmount, s.cashCurrency, s.cashDiscrepancy
         FROM deliveryrunstop s
         JOIN deliveryrun r ON r.id = s.runId AND r.shopId = s.shopId
         JOIN driver d ON d.id = r.driverId AND d.shopId = r.shopId
         JOIN \`order\` o ON o.id = s.orderId AND o.shopId = s.shopId
        WHERE ${conditions.join(' AND ')}
        ORDER BY r.id DESC
        LIMIT 5000`,
      params,
    );
    const runs = new Map<
      number,
      {
        runId: number;
        driverId: number;
        driverName: string;
        runDate: string | null;
        buckets: Map<string, CashBucket>;
      }
    >();
    for (const r of rows) {
      let run = runs.get(r.runId as number);
      if (!run) {
        run = {
          runId: r.runId as number,
          driverId: r.driverId as number,
          driverName: r.driverName as string,
          runDate: r.runDate as string | null,
          buckets: new Map(),
        };
        runs.set(run.runId, run);
      }
      const currency = (r.cashCurrency as string | null) ?? 'AED';
      let b = run.buckets.get(currency);
      if (!b) {
        b = { expected: 0, collected: 0, pending: 0, discrepancies: 0 };
        run.buckets.set(currency, b);
      }
      b.expected +=
        decimalToMinor(r.codExpected as string | null, currency) ?? 0;
      b.collected +=
        decimalToMinor(r.cashCollectedAmount as string | null, currency) ?? 0;
      if (r.cashDiscrepancy) b.discrepancies += 1;
    }
    return [...runs.values()].map((run) => ({
      runId: run.runId,
      driverId: run.driverId,
      driverName: run.driverName,
      runDate: run.runDate,
      totals: [...run.buckets.entries()].map(([currency, b]) => ({
        currency,
        expected: minorToDecimal(b.expected, currency),
        collected: minorToDecimal(b.collected, currency),
        difference: minorToDecimal(b.collected - b.expected, currency),
        discrepancies: b.discrepancies,
      })),
    }));
  }

  // The outlet's ready queue: delivery orders that can be put on a run right
  // now. Same eligibility as addStops (one definition, `ineligibilitySql`).
  async readyOrders(ctx: TenantContext, query: ReadyOrdersQueryDto) {
    const outletId = resolveOutletFilter(ctx, query.outletId);
    if (outletId === undefined) {
      throw new BadRequestException('outletId is required');
    }
    const own = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM outlet WHERE id = ? AND shopId = ?`,
      [outletId, ctx.shopId],
    );
    if (own.length === 0)
      throw new BadRequestException('outletId is invalid for this shop');
    await this.branchRoles.assertPermission(ctx, outletId, 'deliveries.view');
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT o.id, o.shopOrderNumber, o.customerName, o.customerPhone, o.customerAddress, o.area,
              o.deliveryDate, o.deliveryTimeSlot, o.status, o.paymentMethod, o.total, o.currency,
              rg.nameEn AS regionName
         FROM \`order\` o LEFT JOIN region rg ON rg.id = o.regionId
        WHERE o.shopId = ? AND o.outletId = ? AND o.orderType = 'delivery'
          AND o.status IN (${RUNNABLE_ORDER_STATUSES.map(() => '?').join(', ')})
          AND NOT EXISTS (SELECT 1 FROM deliveryrunstop s WHERE s.orderId = o.id AND s.shopId = o.shopId
                           AND (s.activeOrderId IS NOT NULL OR s.status = 'delivered'))
          AND NOT EXISTS (SELECT 1 FROM externaldelivery e WHERE e.orderId = o.id AND e.status <> 'cancelled')
        ORDER BY o.deliveryDate IS NULL, o.deliveryDate ASC, o.id ASC
        LIMIT 200`,
      [ctx.shopId, outletId, ...RUNNABLE_ORDER_STATUSES],
    );
    return rows.map((r) => ({ ...r, total: trimDecimal(r.total as string) }));
  }

  // ---------------------------------------------------------------- writes

  private async assertDriverUsable(
    conn: PoolConnection,
    shopId: number,
    outletId: number,
    driverId: number,
  ) {
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT id FROM driver WHERE id = ? AND shopId = ? AND outletId = ? AND active = 1`,
      [driverId, shopId, outletId],
    );
    if (rows.length === 0) {
      throw new BadRequestException(
        'driverId is not an active driver at this outlet',
      );
    }
  }

  // Validates and returns the orders for a set of ids against ONE shop and ONE
  // outlet. Anything that is not a delivery order of this shop and outlet in a
  // runnable status is reported as an ineligible id; another shop's order and a
  // missing one are indistinguishable ('not_found').
  private async checkOrders(
    conn: PoolConnection,
    shopId: number,
    outletId: number,
    orderIds: number[],
  ): Promise<void> {
    const ph = orderIds.map(() => '?').join(', ');
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT o.id, o.orderType, o.status,
              EXISTS (SELECT 1 FROM externaldelivery e WHERE e.orderId = o.id AND e.status <> 'cancelled') AS external,
              EXISTS (SELECT 1 FROM deliveryrunstop s WHERE s.orderId = o.id AND s.shopId = o.shopId AND s.status = 'delivered') AS wasDelivered
         FROM \`order\` o
        WHERE o.id IN (${ph}) AND o.shopId = ? AND o.outletId = ?`,
      [...orderIds, shopId, outletId],
    );
    const byId = new Map(rows.map((r) => [r.id as number, r]));
    const problems: { orderId: number; reason: OrderIneligibility }[] = [];
    for (const id of orderIds) {
      const o = byId.get(id);
      let reason: OrderIneligibility | null = null;
      if (!o) reason = 'not_found';
      else if (o.orderType !== 'delivery') reason = 'not_delivery';
      else if (!RUNNABLE_ORDER_STATUSES.includes(o.status as string))
        reason = 'bad_status';
      else if (Number(o.external) === 1) reason = 'external_courier';
      else if (Number(o.wasDelivered) === 1) reason = 'already_delivered';
      if (reason) problems.push({ orderId: id, reason });
    }
    if (problems.length > 0) {
      throw new BadRequestException({
        statusCode: 400,
        message: `These orders cannot be put on a run: ${problems
          .map((p) => `#${p.orderId} (${p.reason})`)
          .join(', ')}`,
        details: problems,
      });
    }
  }

  private async insertStops(
    conn: PoolConnection,
    shopId: number,
    runId: number,
    orderIds: number[],
  ) {
    const [maxRows] = await conn.query<RowDataPacket[]>(
      `SELECT COALESCE(MAX(position), 0) AS m, COUNT(*) AS c FROM deliveryrunstop WHERE runId = ? AND shopId = ?`,
      [runId, shopId],
    );
    if (Number(maxRows[0].c) + orderIds.length > MAX_STOPS_PER_RUN) {
      throw new BadRequestException(
        `A run holds at most ${MAX_STOPS_PER_RUN} stops`,
      );
    }
    let position = Number(maxRows[0].m);
    for (const orderId of orderIds) {
      position += 1;
      try {
        // activeOrderId is the atomic guard: UNIQUE, so a second live run
        // cannot take the same order even under a race.
        await conn.query(
          `INSERT INTO deliveryrunstop (shopId, runId, orderId, position, activeOrderId) VALUES (?, ?, ?, ?, ?)`,
          [shopId, runId, orderId, position, orderId],
        );
      } catch (error) {
        if (isDuplicateKeyError(error)) {
          throw new ConflictException(
            `Order #${orderId} is already on an active run`,
          );
        }
        throw error;
      }
    }
  }

  async create(ctx: TenantContext, dto: CreateDeliveryRunDto) {
    const outletId = resolveOutletFilter(ctx, dto.outletId);
    if (outletId === undefined) {
      throw new BadRequestException('outletId is required');
    }
    const own = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM outlet WHERE id = ? AND shopId = ?`,
      [outletId, ctx.shopId],
    );
    if (own.length === 0)
      throw new BadRequestException('outletId is invalid for this shop');
    await this.branchRoles.assertPermission(ctx, outletId, 'deliveries.manage');

    const runId = await this.db.transaction(async (conn) => {
      await this.assertDriverUsable(conn, ctx.shopId, outletId, dto.driverId);
      const [res] = await conn.query(
        `INSERT INTO deliveryrun (shopId, outletId, driverId, runDate, notes, proofRequirement, createdByUserId)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          ctx.shopId,
          outletId,
          dto.driverId,
          dto.runDate ?? null,
          dto.notes ?? null,
          dto.proofRequirement ?? 'photo_or_otp',
          ctx.userId,
        ],
      );
      const newId = (res as { insertId: number }).insertId;
      if (dto.orderIds?.length) {
        await this.checkOrders(conn, ctx.shopId, outletId, dto.orderIds);
        await this.insertStops(conn, ctx.shopId, newId, dto.orderIds);
      }
      return newId;
    });
    await this.audit.logCtx(ctx, {
      action: 'delivery_run.created',
      entityType: 'delivery_run',
      entityId: runId,
      after: { driverId: dto.driverId, outletId, orderIds: dto.orderIds ?? [] },
    });
    return this.findOne(ctx, runId);
  }

  async update(ctx: TenantContext, id: number, dto: UpdateDeliveryRunDto) {
    const run = await this.loadRun(ctx, id, 'deliveries.manage');
    if (run.status !== 'draft' && run.status !== 'dispatched') {
      throw new ConflictException(
        `A ${run.status} run can no longer be edited`,
      );
    }
    const driverChanged =
      dto.driverId !== undefined && dto.driverId !== run.driverId;
    await this.db.transaction(async (conn) => {
      if (driverChanged) {
        await this.assertDriverUsable(
          conn,
          ctx.shopId,
          run.outletId,
          dto.driverId!,
        );
      }
      const set = buildSetClause({
        driverId: dto.driverId,
        runDate: dto.runDate,
        notes: dto.notes,
        proofRequirement: dto.proofRequirement,
      });
      if (set) {
        // CAS on status: an edit that races a dispatch/cancel loses cleanly.
        const [res] = await conn.query(
          `UPDATE deliveryrun SET ${set.setClause}, updatedAt = NOW(3)
            WHERE id = ? AND shopId = ? AND status = ?`,
          [...set.params, id, ctx.shopId, run.status],
        );
        if ((res as { affectedRows: number }).affectedRows === 0) {
          throw new ConflictException('The run changed, refresh and retry');
        }
      }
      // A new driver must not inherit the old driver's link.
      if (driverChanged) {
        await conn.query(
          `UPDATE deliveryrunlink SET revokedAt = NOW(3) WHERE runId = ? AND shopId = ? AND revokedAt IS NULL`,
          [id, ctx.shopId],
        );
      }
    });
    await this.audit.logCtx(ctx, {
      action: 'delivery_run.updated',
      entityType: 'delivery_run',
      entityId: id,
      before: {
        driverId: run.driverId,
        notes: run.notes,
        proofRequirement: run.proofRequirement,
      },
      after: { ...dto },
    });
    return this.findOne(ctx, id);
  }

  async addStops(ctx: TenantContext, id: number, dto: AddStopsDto) {
    const run = await this.loadRun(ctx, id, 'deliveries.manage');
    await this.db.transaction(async (conn) => {
      const [locked] = await conn.query<RunRow[]>(
        `SELECT status FROM deliveryrun WHERE id = ? AND shopId = ? FOR UPDATE`,
        [id, ctx.shopId],
      );
      if (locked[0]?.status !== 'draft') {
        throw new ConflictException('Orders can only be added to a draft run');
      }
      await this.checkOrders(conn, ctx.shopId, run.outletId, dto.orderIds);
      await this.insertStops(conn, ctx.shopId, id, dto.orderIds);
    });
    await this.audit.logCtx(ctx, {
      action: 'delivery_run.stops_added',
      entityType: 'delivery_run',
      entityId: id,
      after: { orderIds: dto.orderIds },
    });
    return this.findOne(ctx, id);
  }

  async removeStop(ctx: TenantContext, id: number, stopId: number) {
    await this.loadRun(ctx, id, 'deliveries.manage');
    await this.db.transaction(async (conn) => {
      const [locked] = await conn.query<RunRow[]>(
        `SELECT status FROM deliveryrun WHERE id = ? AND shopId = ? FOR UPDATE`,
        [id, ctx.shopId],
      );
      const status = locked[0]?.status as string | undefined;
      if (!status || !LIVE_RUN_STATUSES.includes(status)) {
        throw new ConflictException('This run is finished');
      }
      const [res] = await conn.query(
        `DELETE FROM deliveryrunstop WHERE id = ? AND runId = ? AND shopId = ? AND status = 'pending'`,
        [stopId, id, ctx.shopId],
      );
      if ((res as { affectedRows: number }).affectedRows === 0) {
        // Not on this run, or already delivered/failed (history is kept).
        throw new NotFoundException(`No pending stop ${stopId} on this run`);
      }
      await this.compactPositions(conn, ctx.shopId, id);
      if (status !== 'draft') {
        await completeRunIfDone(connExec(conn), ctx.shopId, id);
      }
    });
    await this.audit.logCtx(ctx, {
      action: 'delivery_run.stop_removed',
      entityType: 'delivery_run',
      entityId: id,
      after: { stopId },
    });
    return this.findOne(ctx, id);
  }

  private async compactPositions(
    conn: PoolConnection,
    shopId: number,
    runId: number,
  ) {
    const [rows] = await conn.query<RowDataPacket[]>(
      `SELECT id FROM deliveryrunstop WHERE runId = ? AND shopId = ? ORDER BY position ASC, id ASC`,
      [runId, shopId],
    );
    let position = 0;
    for (const r of rows) {
      position += 1;
      await conn.query(`UPDATE deliveryrunstop SET position = ? WHERE id = ?`, [
        position,
        r.id,
      ]);
    }
  }

  async reorder(ctx: TenantContext, id: number, dto: ReorderStopsDto) {
    await this.loadRun(ctx, id, 'deliveries.manage');
    await this.db.transaction(async (conn) => {
      const [locked] = await conn.query<RunRow[]>(
        `SELECT status FROM deliveryrun WHERE id = ? AND shopId = ? FOR UPDATE`,
        [id, ctx.shopId],
      );
      const status = locked[0]?.status as string | undefined;
      if (!status || !LIVE_RUN_STATUSES.includes(status)) {
        throw new ConflictException('This run is finished');
      }
      const [stops] = await conn.query<RowDataPacket[]>(
        `SELECT id FROM deliveryrunstop WHERE runId = ? AND shopId = ?`,
        [id, ctx.shopId],
      );
      const current = new Set(stops.map((s) => s.id as number));
      if (
        current.size !== dto.stopIds.length ||
        !dto.stopIds.every((s) => current.has(s))
      ) {
        throw new BadRequestException(
          'stopIds must list every stop of this run exactly once',
        );
      }
      let position = 0;
      for (const stopId of dto.stopIds) {
        position += 1;
        await conn.query(
          `UPDATE deliveryrunstop SET position = ? WHERE id = ? AND runId = ? AND shopId = ?`,
          [position, stopId, id, ctx.shopId],
        );
      }
    });
    return this.findOne(ctx, id);
  }

  // draft -> dispatched. Every order is re-validated, the status moves by CAS,
  // and only then are the orders pushed through the SAME order state machine the
  // kanban uses (preparing -> out_for_delivery), so the customer is told and the
  // timeline records it. An order that changed underneath us (cancelled) has its
  // stop failed with a reason rather than aborting the whole dispatch.
  async dispatch(ctx: TenantContext, id: number) {
    const run = await this.loadRun(ctx, id, 'deliveries.manage');
    await this.branchRoles.assertPermission(ctx, run.outletId, 'orders.manage');
    if (run.status !== 'draft') {
      throw new ConflictException(`A ${run.status} run cannot be dispatched`);
    }
    const stops = await this.db.query<RowDataPacket[]>(
      `SELECT s.id, s.orderId, o.status AS orderStatus, o.orderType
         FROM deliveryrunstop s JOIN \`order\` o ON o.id = s.orderId AND o.shopId = s.shopId
        WHERE s.runId = ? AND s.shopId = ? ORDER BY s.position`,
      [id, ctx.shopId],
    );
    if (stops.length === 0) {
      throw new BadRequestException(
        'Add at least one order before dispatching',
      );
    }
    const bad = stops.filter(
      (s) =>
        s.orderType !== 'delivery' ||
        !RUNNABLE_ORDER_STATUSES.includes(s.orderStatus as string),
    );
    if (bad.length > 0) {
      throw new ConflictException(
        `These orders are no longer ready: ${bad.map((s) => `#${s.orderId as number}`).join(', ')}. Remove them and try again`,
      );
    }
    const driver = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM driver WHERE id = ? AND shopId = ? AND outletId = ? AND active = 1`,
      [run.driverId, ctx.shopId, run.outletId],
    );
    if (driver.length === 0) {
      throw new ConflictException('The assigned driver is no longer active');
    }

    const claimed = await this.db.execute(
      `UPDATE deliveryrun SET status = 'dispatched', dispatchedAt = NOW(3), updatedAt = NOW(3)
        WHERE id = ? AND shopId = ? AND status = 'draft'`,
      [id, ctx.shopId],
    );
    if (claimed.affectedRows === 0) {
      throw new ConflictException(
        'The run was changed by someone else, refresh and retry',
      );
    }

    for (const stop of stops) {
      if (stop.orderStatus !== 'preparing') continue;
      try {
        await this.orders.updateStatus(ctx, stop.orderId as number, {
          status: 'out_for_delivery',
        });
      } catch (error) {
        logger.warn('dispatch: order could not be moved out for delivery', {
          shopId: ctx.shopId,
          runId: id,
          orderId: stop.orderId,
          error: error instanceof Error ? error.message : String(error),
        });
        await this.db.execute(
          `UPDATE deliveryrunstop SET status = 'failed', failureReason = 'order_changed', failedAt = NOW(3), activeOrderId = NULL, updatedAt = NOW(3)
            WHERE id = ? AND shopId = ? AND status = 'pending'`,
          [stop.id as number, ctx.shopId],
        );
      }
    }
    await completeRunIfDone(
      (sql, params) => this.db.execute(sql, params).then((r) => r.affectedRows),
      ctx.shopId,
      id,
    );
    await this.audit.logCtx(ctx, {
      action: 'delivery_run.dispatched',
      entityType: 'delivery_run',
      entityId: id,
      after: { driverId: run.driverId, stops: stops.length },
    });
    return this.findOne(ctx, id);
  }

  async cancel(ctx: TenantContext, id: number) {
    const run = await this.loadRun(ctx, id, 'deliveries.manage');
    await this.db.transaction(async (conn) => {
      const [res] = await conn.query(
        `UPDATE deliveryrun SET status = 'cancelled', cancelledAt = NOW(3), updatedAt = NOW(3)
          WHERE id = ? AND shopId = ? AND status IN ('draft', 'dispatched', 'in_progress')`,
        [id, ctx.shopId],
      );
      if ((res as { affectedRows: number }).affectedRows === 0) {
        throw new ConflictException(`A ${run.status} run cannot be cancelled`);
      }
      // Pending stops are released (activeOrderId NULL) so the orders can be put
      // on a new run. Delivered stops keep their history. The orders themselves
      // are left alone: they stay where the state machine has them.
      await conn.query(
        `UPDATE deliveryrunstop SET status = 'failed', failureReason = 'run_cancelled', failedAt = NOW(3),
                activeOrderId = NULL, updatedAt = NOW(3)
          WHERE runId = ? AND shopId = ? AND status = 'pending'`,
        [id, ctx.shopId],
      );
      await conn.query(
        `UPDATE deliveryrunlink SET revokedAt = NOW(3) WHERE runId = ? AND shopId = ? AND revokedAt IS NULL`,
        [id, ctx.shopId],
      );
    });
    await this.audit.logCtx(ctx, {
      action: 'delivery_run.cancelled',
      entityType: 'delivery_run',
      entityId: id,
      before: { status: run.status },
    });
    return this.findOne(ctx, id);
  }
}
