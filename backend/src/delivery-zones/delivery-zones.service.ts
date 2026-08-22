import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { buildSetClause } from '../database/update.util';
import { CreateDeliveryZoneDto } from './dto/create-delivery-zone.dto';
import { UpdateDeliveryZoneDto } from './dto/update-delivery-zone.dto';
import type { RowDataPacket } from 'mysql2/promise';
import type { DeliveryzoneRow } from '../db/types';
import type { TenantContext } from '../common/tenant-context';
import { BranchRolesService } from '../branch-roles/branch-roles.service';

// Additive to (not replacing) the radius-based deliveryRadiusKm on the
// outlet — named flat-fee zones for merchants who want per-area pricing
// instead of, or alongside, a single radius.
@Injectable()
export class DeliveryZonesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly branchRolesService: BranchRolesService,
  ) {}

  async findAll(ctx: TenantContext, outletId: number) {
    await this.assertOutletAccessible(ctx, outletId);
    return this.db.query<(DeliveryzoneRow & RowDataPacket)[]>(
      `SELECT * FROM deliveryzone WHERE outletId = ? ORDER BY id ASC`,
      [outletId],
    );
  }

  async create(
    ctx: TenantContext,
    outletId: number,
    dto: CreateDeliveryZoneDto,
  ) {
    await this.assertOutletBelongsToShop(ctx, outletId);
    const result = await this.db.execute(
      `INSERT INTO deliveryzone (outletId, name, fee, minOrderAmount, isActive, lat, lng, radiusKm)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        outletId,
        dto.name,
        dto.fee,
        dto.minOrderAmount ?? 0,
        dto.isActive ?? true,
        dto.lat ?? null,
        dto.lng ?? null,
        dto.radiusKm ?? null,
      ],
    );
    return this.findZoneById(result.insertId);
  }

  async update(
    ctx: TenantContext,
    outletId: number,
    zoneId: number,
    dto: UpdateDeliveryZoneDto,
  ) {
    await this.assertOutletBelongsToShop(ctx, outletId);
    await this.assertZoneBelongsToOutlet(zoneId, outletId);
    const set = buildSetClause({
      name: dto.name,
      fee: dto.fee,
      minOrderAmount: dto.minOrderAmount,
      isActive: dto.isActive,
      lat: dto.lat,
      lng: dto.lng,
      radiusKm: dto.radiusKm,
    });
    if (set) {
      await this.db.execute(
        `UPDATE deliveryzone SET ${set.setClause} WHERE id = ?`,
        [...set.params, zoneId],
      );
    }
    return this.findZoneById(zoneId);
  }

  async remove(ctx: TenantContext, outletId: number, zoneId: number) {
    await this.assertOutletBelongsToShop(ctx, outletId);
    await this.assertZoneBelongsToOutlet(zoneId, outletId);
    await this.db.execute(`DELETE FROM deliveryzone WHERE id = ?`, [zoneId]);
    return { id: zoneId, deleted: true };
  }

  private async findZoneById(id: number) {
    const rows = await this.db.query<(DeliveryzoneRow & RowDataPacket)[]>(
      `SELECT * FROM deliveryzone WHERE id = ?`,
      [id],
    );
    return rows[0];
  }

  // Read access follows the same branch outlet-override rule as outlet CRUD
  // itself — a branch account can view its own outlet's zones, never a
  // sibling's. Write access is @Roles('admin') at the controller.
  private async assertOutletAccessible(ctx: TenantContext, outletId: number) {
    if (ctx.role === 'branch' && outletId !== ctx.outletId) {
      throw new NotFoundException(`Outlet ${outletId} not found`);
    }
    await this.assertOutletBelongsToShop(ctx, outletId);
    await this.branchRolesService.assertPermission(
      ctx,
      outletId,
      'delivery_zones.view',
    );
  }

  private async assertOutletBelongsToShop(
    ctx: TenantContext,
    outletId: number,
  ) {
    const rows = await this.db.query(
      `SELECT id FROM outlet WHERE id = ? AND shopId = ?`,
      [outletId, ctx.shopId],
    );
    if (rows.length === 0) {
      throw new NotFoundException(`Outlet ${outletId} not found`);
    }
  }

  // A zoneId that belongs to a *different* outlet than the one in the URL
  // must 404, not silently operate on the wrong outlet's zone.
  private async assertZoneBelongsToOutlet(zoneId: number, outletId: number) {
    const rows = await this.db.query(
      `SELECT id FROM deliveryzone WHERE id = ? AND outletId = ?`,
      [zoneId, outletId],
    );
    if (rows.length === 0) {
      throw new NotFoundException(`Delivery zone ${zoneId} not found`);
    }
  }
}
