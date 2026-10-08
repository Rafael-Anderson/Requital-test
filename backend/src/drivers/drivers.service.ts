import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import type { QueryParam } from '../database/database.service';
import { buildSetClause } from '../database/update.util';
import type { DriverRow } from '../db/types';
import type { TenantContext } from '../common/tenant-context';
import { resolveOutletFilter } from '../common/outlet-scope';
import { BranchRolesService } from '../branch-roles/branch-roles.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import {
  CreateDriverDto,
  ListDriversQueryDto,
  UpdateDriverDto,
} from './dto/driver.dto';

type DriverResponse = Omit<DriverRow, 'active'> & { active: boolean };

// A merchant's OWN drivers. Not users: no login, no role. Every query is scoped
// by shopId, and a branch user is pinned to its outlet through
// resolveOutletFilter (a driver at another outlet is a 404, never a 403).
@Injectable()
export class DriversService {
  constructor(
    private readonly db: DatabaseService,
    private readonly branchRoles: BranchRolesService,
    private readonly audit: AuditLogService,
  ) {}

  async findAll(
    ctx: TenantContext,
    query: ListDriversQueryDto,
  ): Promise<DriverResponse[]> {
    const outletId = resolveOutletFilter(ctx, query.outletId);
    if (outletId !== undefined) {
      // A list with a RESOLVED outlet must assert the permission too: only an
      // unresolved (shop-wide admin) list skips it.
      await this.branchRoles.assertPermission(ctx, outletId, 'deliveries.view');
    }
    const conditions = ['shopId = ?'];
    const params: QueryParam[] = [ctx.shopId];
    if (outletId !== undefined) {
      conditions.push('outletId = ?');
      params.push(outletId);
    }
    if (query.active !== undefined) {
      conditions.push('active = ?');
      params.push(query.active === 'true' ? 1 : 0);
    }
    return this.db.query<(DriverRow & RowDataPacket)[]>(
      `SELECT * FROM driver WHERE ${conditions.join(' AND ')} ORDER BY active DESC, name ASC`,
      params,
    );
  }

  // The one scoped lookup every by-id operation goes through. `permission` is
  // checked against the FETCHED row's own outlet, not the request's.
  async load(
    ctx: TenantContext,
    id: number,
    permission: 'deliveries.view' | 'deliveries.manage',
  ): Promise<DriverRow> {
    const outletId = resolveOutletFilter(ctx);
    const conditions = ['id = ?', 'shopId = ?'];
    const params: QueryParam[] = [id, ctx.shopId];
    if (outletId !== undefined) {
      conditions.push('outletId = ?');
      params.push(outletId);
    }
    const rows = await this.db.query<(DriverRow & RowDataPacket)[]>(
      `SELECT * FROM driver WHERE ${conditions.join(' AND ')}`,
      params,
    );
    if (rows.length === 0)
      throw new NotFoundException(`Driver ${id} not found`);
    await this.branchRoles.assertPermission(ctx, rows[0].outletId, permission);
    return rows[0];
  }

  findOne(ctx: TenantContext, id: number) {
    return this.load(ctx, id, 'deliveries.view');
  }

  async create(ctx: TenantContext, dto: CreateDriverDto) {
    const outletId = resolveOutletFilter(ctx, dto.outletId);
    if (outletId === undefined) {
      throw new BadRequestException('outletId is required');
    }
    const outlets = await this.db.query<RowDataPacket[]>(
      `SELECT id FROM outlet WHERE id = ? AND shopId = ?`,
      [outletId, ctx.shopId],
    );
    if (outlets.length === 0) {
      throw new BadRequestException('outletId is invalid for this shop');
    }
    await this.branchRoles.assertPermission(ctx, outletId, 'deliveries.manage');
    const result = await this.db.execute(
      `INSERT INTO driver (shopId, outletId, name, phone) VALUES (?, ?, ?, ?)`,
      [ctx.shopId, outletId, dto.name, dto.phone],
    );
    await this.audit.logCtx(ctx, {
      action: 'driver.created',
      entityType: 'driver',
      entityId: result.insertId,
      after: { name: dto.name, outletId },
    });
    return this.findOne(ctx, result.insertId);
  }

  async update(ctx: TenantContext, id: number, dto: UpdateDriverDto) {
    const before = await this.load(ctx, id, 'deliveries.manage');
    const set = buildSetClause({
      name: dto.name,
      phone: dto.phone,
      active: dto.active === undefined ? undefined : dto.active ? 1 : 0,
    });
    if (!set) return before;
    await this.db.transaction(async (conn) => {
      await conn.query(
        `UPDATE driver SET ${set.setClause}, updatedAt = NOW(3) WHERE id = ? AND shopId = ?`,
        [...set.params, id, ctx.shopId],
      );
      // A deactivated driver's links die with it, in the same transaction, so
      // there is no window in which an inactive driver still holds a live link.
      // (DriverAppService also joins driver.active on every request.)
      if (dto.active === false) {
        await conn.query(
          `UPDATE deliveryrunlink SET revokedAt = NOW(3)
            WHERE driverId = ? AND shopId = ? AND revokedAt IS NULL`,
          [id, ctx.shopId],
        );
      }
    });
    await this.audit.logCtx(ctx, {
      action:
        dto.active === false
          ? 'driver.deactivated'
          : dto.active === true && !before.active
            ? 'driver.activated'
            : 'driver.updated',
      entityType: 'driver',
      entityId: id,
      before: { name: before.name, phone: before.phone, active: before.active },
      after: { name: dto.name, phone: dto.phone, active: dto.active },
    });
    return this.findOne(ctx, id);
  }

  // Delete when the driver has no history; otherwise deactivate (and kill its
  // links), because runs and cash records keep pointing at the row.
  async remove(ctx: TenantContext, id: number) {
    const driver = await this.load(ctx, id, 'deliveries.manage');
    const result = await this.db.transaction(async (conn) => {
      await conn.query(
        `UPDATE deliveryrunlink SET revokedAt = NOW(3)
          WHERE driverId = ? AND shopId = ? AND revokedAt IS NULL`,
        [id, ctx.shopId],
      );
      const [runs] = await conn.query<RowDataPacket[]>(
        `SELECT 1 FROM deliveryrun WHERE driverId = ? AND shopId = ? LIMIT 1 FOR UPDATE`,
        [id, ctx.shopId],
      );
      const [paid] = await conn.query<RowDataPacket[]>(
        `SELECT 1 FROM \`order\` WHERE cashCollectedByDriverId = ? AND shopId = ? LIMIT 1`,
        [id, ctx.shopId],
      );
      if (runs.length > 0 || paid.length > 0) {
        await conn.query(
          `UPDATE driver SET active = 0 WHERE id = ? AND shopId = ?`,
          [id, ctx.shopId],
        );
        return { deleted: false, deactivated: true };
      }
      await conn.query(`DELETE FROM driver WHERE id = ? AND shopId = ?`, [
        id,
        ctx.shopId,
      ]);
      return { deleted: true, deactivated: false };
    });
    await this.audit.logCtx(ctx, {
      action: result.deleted ? 'driver.deleted' : 'driver.deactivated',
      entityType: 'driver',
      entityId: id,
      before: { name: driver.name, active: driver.active },
    });
    return result;
  }
}
