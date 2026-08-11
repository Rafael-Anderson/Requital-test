import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import type { QueryParam } from '../database/database.service';
import { isDuplicateKeyError } from '../database/mysql-errors';
import type { AffiliateRow, AffiliatecodeRow } from '../db/types';
import type { TenantContext } from '../common/tenant-context';
import { CreateAffiliateDto } from './dto/create-affiliate.dto';
import { UpdateAffiliateDto } from './dto/update-affiliate.dto';
import { CreateAffiliateCodeDto } from './dto/create-affiliate-code.dto';
import { UpdateAffiliateCodeDto } from './dto/update-affiliate-code.dto';
import { UpdateAffiliateOrderStatusDto } from './dto/update-affiliate-order-status.dto';
import { ListQueryDto } from './dto/list-query.dto';

const STOREFRONT_URL = process.env.STOREFRONT_URL ?? 'http://localhost:3002';

@Injectable()
export class AffiliateService {
  constructor(private readonly db: DatabaseService) {}

  // ---------- Affiliate tab ----------

  async getSummary(ctx: TenantContext) {
    const [
      totalCodeRows,
      totalAffiliateRows,
      activeAffiliateRows,
      codesByStatusRows,
      pendingOrdersRows,
      approvedOrdersRows,
    ] = await Promise.all([
      this.db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM affiliatecode WHERE shopId = ?`,
        [ctx.shopId],
      ),
      this.db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM affiliate WHERE shopId = ?`,
        [ctx.shopId],
      ),
      this.db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM affiliate WHERE shopId = ? AND status = 'active'`,
        [ctx.shopId],
      ),
      this.db.query<RowDataPacket[]>(
        `SELECT status, COUNT(*) AS c FROM affiliatecode WHERE shopId = ? GROUP BY status`,
        [ctx.shopId],
      ),
      this.db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM affiliateorder WHERE shopId = ? AND status = 'pending'`,
        [ctx.shopId],
      ),
      this.db.query<RowDataPacket[]>(
        `SELECT o.total AS orderTotal FROM affiliateorder ao
         JOIN \`order\` o ON o.id = ao.orderId
         WHERE ao.shopId = ? AND ao.status = 'approved'`,
        [ctx.shopId],
      ),
    ]);

    const codeStatus = { approved: 0, pending: 0, blocked: 0 };
    for (const row of codesByStatusRows) {
      const status = row.status as string;
      if (status in codeStatus)
        codeStatus[status as keyof typeof codeStatus] = Number(row.c);
    }

    return {
      totalCode: Number(totalCodeRows[0].c),
      totalAffiliate: Number(totalAffiliateRows[0].c),
      activeAffiliate: Number(activeAffiliateRows[0].c),
      pendingOrders: Number(pendingOrdersRows[0].c),
      // Revenue driven through approved affiliate orders (order totals, not
      // commission payable — the per-order commission owed is shown on the
      // Affiliate Orders tab instead).
      approvedOrderRevenue: approvedOrdersRows.reduce(
        (sum, r) => sum + Number(r.orderTotal),
        0,
      ),
      codeStatus,
    };
  }

  async findAllAffiliates(ctx: TenantContext, query: ListQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const search = query.search?.trim();
    const conditions = ['a.shopId = ?'];
    const params: QueryParam[] = [ctx.shopId];
    if (search) {
      conditions.push('(a.name LIKE ? OR a.mobile LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }
    const where = conditions.join(' AND ');

    const [rows, totalRows] = await Promise.all([
      this.db.query<RowDataPacket[]>(
        `SELECT a.*,
                (SELECT COUNT(*) FROM affiliatecode ac WHERE ac.affiliateId = a.id) AS codesCount,
                (SELECT COUNT(*) FROM affiliateorder ao
                 JOIN affiliatecode ac ON ac.id = ao.affiliateCodeId
                 WHERE ac.affiliateId = a.id) AS ordersCount
         FROM affiliate a
         WHERE ${where}
         ORDER BY a.createdAt DESC
         LIMIT ? OFFSET ?`,
        [...params, pageSize, (page - 1) * pageSize],
      ),
      this.db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM affiliate a WHERE ${where}`,
        params,
      ),
    ]);

    return {
      data: rows.map((a) => ({
        id: a.id as number,
        name: a.name as string,
        mobile: a.mobile as string,
        status: a.status as string,
        createdAt: a.createdAt as Date,
        codesCount: Number(a.codesCount),
        ordersCount: Number(a.ordersCount),
      })),
      page,
      pageSize,
      total: Number(totalRows[0].c),
    };
  }

  async createAffiliate(ctx: TenantContext, dto: CreateAffiliateDto) {
    const result = await this.db.execute(
      `INSERT INTO affiliate (shopId, name, mobile) VALUES (?, ?, ?)`,
      [ctx.shopId, dto.name, dto.mobile],
    );
    const rows = await this.db.query<(AffiliateRow & RowDataPacket)[]>(
      `SELECT * FROM affiliate WHERE id = ?`,
      [result.insertId],
    );
    return rows[0];
  }

  async updateAffiliate(
    ctx: TenantContext,
    id: number,
    dto: UpdateAffiliateDto,
  ) {
    await this.assertAffiliateBelongsToShop(ctx, id);
    const setParts: string[] = [];
    const params: QueryParam[] = [];
    if (dto.name !== undefined) {
      setParts.push('name = ?');
      params.push(dto.name);
    }
    if (dto.mobile !== undefined) {
      setParts.push('mobile = ?');
      params.push(dto.mobile);
    }
    if (dto.status !== undefined) {
      setParts.push('status = ?');
      params.push(dto.status);
    }
    if (setParts.length > 0) {
      await this.db.execute(`UPDATE affiliate SET ${setParts.join(', ')} WHERE id = ?`, [
        ...params,
        id,
      ]);
    }
    const rows = await this.db.query<(AffiliateRow & RowDataPacket)[]>(
      `SELECT * FROM affiliate WHERE id = ?`,
      [id],
    );
    return rows[0];
  }

  // ---------- Affiliate Codes tab ----------

  async findAllCodes(ctx: TenantContext, query: ListQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const search = query.search?.trim();
    const conditions = ['ac.shopId = ?'];
    const params: QueryParam[] = [ctx.shopId];
    if (search) {
      conditions.push('(ac.code LIKE ? OR ac.promotionFor LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }
    const where = conditions.join(' AND ');

    const [shopRows, rows, totalRows] = await Promise.all([
      this.db.query<RowDataPacket[]>(`SELECT subdomain FROM shop WHERE id = ?`, [
        ctx.shopId,
      ]),
      this.db.query<RowDataPacket[]>(
        `SELECT ac.*, af.name AS affiliateName,
                (SELECT COUNT(*) FROM affiliateorder ao WHERE ao.affiliateCodeId = ac.id) AS ordersCount
         FROM affiliatecode ac
         JOIN affiliate af ON af.id = ac.affiliateId
         WHERE ${where}
         ORDER BY ac.createdAt DESC
         LIMIT ? OFFSET ?`,
        [...params, pageSize, (page - 1) * pageSize],
      ),
      this.db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM affiliatecode ac WHERE ${where}`,
        params,
      ),
    ]);
    const subdomain = shopRows[0].subdomain as string;

    return {
      data: rows.map((c) => ({
        id: c.id as number,
        code: c.code as string,
        affiliateId: c.affiliateId as number,
        affiliateName: c.affiliateName as string,
        promotionFor: c.promotionFor as string,
        url: `${STOREFRONT_URL}/${subdomain}?ref=${c.code as string}`,
        status: c.status as string,
        commissionType: c.commissionType as string,
        commissionValue: Number(c.commissionValue),
        validFrom: c.validFrom as Date | null,
        validUntil: c.validUntil as Date | null,
        ordersCount: Number(c.ordersCount),
        createdAt: c.createdAt as Date,
      })),
      page,
      pageSize,
      total: Number(totalRows[0].c),
    };
  }

  async createCode(ctx: TenantContext, dto: CreateAffiliateCodeDto) {
    const affiliateRows = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM affiliate WHERE id = ? AND shopId = ?`,
      [dto.affiliateId, ctx.shopId],
    );
    if (affiliateRows.length === 0) {
      throw new NotFoundException(`Affiliate ${dto.affiliateId} not found`);
    }
    if (
      dto.validFrom &&
      dto.validUntil &&
      new Date(dto.validFrom) > new Date(dto.validUntil)
    ) {
      throw new BadRequestException('validFrom must be before validUntil');
    }

    try {
      const result = await this.db.execute(
        `INSERT INTO affiliatecode (shopId, affiliateId, code, promotionFor, commissionType, commissionValue, validFrom, validUntil)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          ctx.shopId,
          dto.affiliateId,
          dto.code,
          dto.promotionFor ?? 'All Products',
          dto.commissionType,
          dto.commissionValue,
          dto.validFrom ? new Date(dto.validFrom) : null,
          dto.validUntil ? new Date(dto.validUntil) : null,
        ],
      );
      const rows = await this.db.query<(AffiliatecodeRow & RowDataPacket)[]>(
        `SELECT * FROM affiliatecode WHERE id = ?`,
        [result.insertId],
      );
      return rows[0];
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictException(
          `Code '${dto.code}' already exists for this shop`,
        );
      }
      throw error;
    }
  }

  async updateCode(
    ctx: TenantContext,
    id: number,
    dto: UpdateAffiliateCodeDto,
  ) {
    await this.assertCodeBelongsToShop(ctx, id);
    const setParts: string[] = [];
    const params: QueryParam[] = [];
    if (dto.promotionFor !== undefined) {
      setParts.push('promotionFor = ?');
      params.push(dto.promotionFor);
    }
    if (dto.status !== undefined) {
      setParts.push('status = ?');
      params.push(dto.status);
    }
    if (dto.commissionType !== undefined) {
      setParts.push('commissionType = ?');
      params.push(dto.commissionType);
    }
    if (dto.commissionValue !== undefined) {
      setParts.push('commissionValue = ?');
      params.push(dto.commissionValue);
    }
    if (dto.validFrom !== undefined) {
      setParts.push('validFrom = ?');
      params.push(dto.validFrom ? new Date(dto.validFrom) : null);
    }
    if (dto.validUntil !== undefined) {
      setParts.push('validUntil = ?');
      params.push(dto.validUntil ? new Date(dto.validUntil) : null);
    }
    if (setParts.length > 0) {
      await this.db.execute(`UPDATE affiliatecode SET ${setParts.join(', ')} WHERE id = ?`, [
        ...params,
        id,
      ]);
    }
    const rows = await this.db.query<(AffiliatecodeRow & RowDataPacket)[]>(
      `SELECT * FROM affiliatecode WHERE id = ?`,
      [id],
    );
    return rows[0];
  }

  // ---------- Affiliate Orders tab ----------

  async findAllOrders(ctx: TenantContext, query: ListQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const [rows, totalRows] = await Promise.all([
      this.db.query<RowDataPacket[]>(
        `SELECT ao.*, o.id AS orderPk, o.customerName AS orderCustomerName, o.total AS orderTotal,
                ac.code AS codeValue, af.name AS affiliateName
         FROM affiliateorder ao
         JOIN \`order\` o ON o.id = ao.orderId
         JOIN affiliatecode ac ON ac.id = ao.affiliateCodeId
         JOIN affiliate af ON af.id = ac.affiliateId
         WHERE ao.shopId = ?
         ORDER BY ao.createdAt DESC
         LIMIT ? OFFSET ?`,
        [ctx.shopId, pageSize, (page - 1) * pageSize],
      ),
      this.db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM affiliateorder WHERE shopId = ?`,
        [ctx.shopId],
      ),
    ]);

    return {
      data: rows.map((r) => ({
        id: r.id as number,
        orderId: r.orderPk as number,
        customerName: r.orderCustomerName as string,
        orderTotal: Number(r.orderTotal),
        code: r.codeValue as string,
        affiliateName: r.affiliateName as string,
        commissionAmount: Number(r.commissionAmount),
        status: r.status as string,
        createdAt: r.createdAt as Date,
      })),
      page,
      pageSize,
      total: Number(totalRows[0].c),
    };
  }

  // Merchant payout-approval action — only ever moves a commission out of
  // 'pending', matching the task's "approve/block a pending commission"
  // framing. Once approved/blocked (whether by this or by the automatic
  // order-lifecycle sync below), it's final.
  async updateOrderStatus(
    ctx: TenantContext,
    id: number,
    dto: UpdateAffiliateOrderStatusDto,
  ) {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT * FROM affiliateorder WHERE id = ? AND shopId = ?`,
      [id, ctx.shopId],
    );
    const row = rows[0];
    if (!row) {
      throw new NotFoundException(`Affiliate order ${id} not found`);
    }
    if (row.status !== 'pending') {
      throw new BadRequestException(
        `Cannot change status — commission is already '${row.status as string}'`,
      );
    }
    await this.db.execute(`UPDATE affiliateorder SET status = ? WHERE id = ?`, [
      dto.status,
      id,
    ]);
    const updated = await this.db.query<RowDataPacket[]>(
      `SELECT * FROM affiliateorder WHERE id = ?`,
      [id],
    );
    return updated[0];
  }

  // ---------- Referral attribution (called from order-creation flows) ----------

  // Validates a storefront/admin-supplied ref code and computes the
  // commission it would earn against this order's total — or returns null
  // for a missing/unknown/blocked/expired code. Never throws: an invalid
  // ref code must never block checkout, only skip attribution (see task).
  async resolveAttribution(
    shopId: number,
    code: string | undefined | null,
    orderTotal: number,
  ): Promise<{ affiliateCodeId: number; commissionAmount: number } | null> {
    const trimmed = code?.trim();
    if (!trimmed) return null;

    const rows = await this.db.query<(AffiliatecodeRow & RowDataPacket)[]>(
      `SELECT * FROM affiliatecode WHERE shopId = ? AND code = ?`,
      [shopId, trimmed],
    );
    const row = rows[0];
    if (!row || row.status !== 'approved') return null;

    const now = new Date();
    if (row.validFrom && now < row.validFrom) return null;
    if (row.validUntil && now > row.validUntil) return null;

    const commissionAmount =
      row.commissionType === 'percentage'
        ? Math.round(orderTotal * Number(row.commissionValue)) / 100
        : Number(row.commissionValue);

    return { affiliateCodeId: row.id, commissionAmount };
  }

  // Called right after the transaction that creates the order (not
  // atomically inside it — OrdersService/PublicService both call this with
  // the plain pool once the order id is known) — accepts either so a
  // caller that DOES have an open connection can still pass it through.
  async recordAttribution(
    runner: PoolConnection | Pool,
    shopId: number,
    orderId: number,
    attribution: { affiliateCodeId: number; commissionAmount: number },
  ) {
    await runner.query(
      `INSERT INTO affiliateorder (shopId, orderId, affiliateCodeId, commissionAmount) VALUES (?, ?, ?, ?)`,
      [shopId, orderId, attribution.affiliateCodeId, attribution.commissionAmount],
    );
  }

  // Auto-sync from the order's own lifecycle — called from
  // OrdersService.updateStatus/cancel and PaymentsService.handleWebhook.
  // Safe no-op if the order has no affiliate attribution at all (the UPDATE
  // just matches zero rows). Only ever moves a commission OUT of 'pending' —
  // never re-derives or reverses a status once set, so a merchant's own
  // manual approve/block (or an earlier auto-sync) is never clobbered by a
  // later lifecycle event.
  async syncOrderStatus(
    orderId: number,
    next: { orderStatus?: string; paymentPaid?: boolean },
  ) {
    const nextStatus =
      next.orderStatus === 'cancelled'
        ? 'blocked'
        : next.orderStatus === 'delivered' || next.paymentPaid
          ? 'approved'
          : null;
    if (!nextStatus) return;
    await this.db.execute(
      `UPDATE affiliateorder SET status = ? WHERE orderId = ? AND status = 'pending'`,
      [nextStatus, orderId],
    );
  }

  private async assertAffiliateBelongsToShop(ctx: TenantContext, id: number) {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM affiliate WHERE id = ? AND shopId = ?`,
      [id, ctx.shopId],
    );
    if (rows.length === 0) {
      throw new NotFoundException(`Affiliate ${id} not found`);
    }
  }

  private async assertCodeBelongsToShop(ctx: TenantContext, id: number) {
    const rows = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM affiliatecode WHERE id = ? AND shopId = ?`,
      [id, ctx.shopId],
    );
    if (rows.length === 0) {
      throw new NotFoundException(`Affiliate code ${id} not found`);
    }
  }
}
