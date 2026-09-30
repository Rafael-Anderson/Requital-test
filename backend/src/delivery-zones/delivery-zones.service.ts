import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { buildSetClause } from '../database/update.util';
import { CreateDeliveryZoneDto } from './dto/create-delivery-zone.dto';
import { UpdateDeliveryZoneDto } from './dto/update-delivery-zone.dto';
import { SetZoneMappingDto } from './dto/set-zone-mapping.dto';
import type { RowDataPacket } from 'mysql2/promise';
import type { DeliveryzoneRow } from '../db/types';
import type { TenantContext } from '../common/tenant-context';
import { BranchRolesService } from '../branch-roles/branch-roles.service';
import { RegionsService, type RegionSummary } from '../regions/regions.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { hasPlacedCircle } from '../public/order-pricing';
import { getZoneMatchingMode } from './zone-matching-mode';
import { describeLegacyMatching, proposeRegions } from './zone-region-mapping';

type ZoneRow = DeliveryzoneRow & RowDataPacket;

// Additive to (not replacing) the radius-based deliveryRadiusKm on the
// outlet — named flat-fee zones for merchants who want per-area pricing
// instead of, or alongside, a single radius.
@Injectable()
export class DeliveryZonesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly branchRolesService: BranchRolesService,
    private readonly regionsService: RegionsService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async findAll(ctx: TenantContext, outletId: number) {
    await this.assertOutletAccessible(ctx, outletId);
    const zones = await this.db.query<ZoneRow[]>(
      `SELECT * FROM deliveryzone WHERE outletId = ? ORDER BY id ASC`,
      [outletId],
    );
    return this.withRegions(zones);
  }

  // The review screen's data: per zone, what it does today in words, the region
  // set it most plausibly means, and whether a merchant has confirmed it. Plus
  // the shop-level answer to "which rule is deciding my fees right now".
  async getMappingProposal(ctx: TenantContext, outletId: number) {
    await this.assertOutletAccessible(ctx, outletId);
    const [zones, list, matching] = await Promise.all([
      this.db.query<ZoneRow[]>(
        `SELECT * FROM deliveryzone WHERE outletId = ? ORDER BY id ASC`,
        [outletId],
      ),
      this.regionsService.listForShop(ctx.shopId),
      getZoneMatchingMode(this.db, ctx.shopId),
    ]);
    const withRegions = await this.withRegions(zones);
    return {
      mode: matching.mode,
      unconfirmedActiveZones: matching.unconfirmedActiveZones,
      country: list.country,
      zones: withRegions.map((z) => {
        const hasCircle = hasPlacedCircle(z);
        return {
          zoneId: z.id,
          name: z.name,
          isActive: z.isActive,
          confirmed: z.mappingConfirmedAt !== null,
          hasPlacedCircle: hasCircle,
          currentRegions: z.regions,
          current: describeLegacyMatching(
            { name: z.name, hasPlacedCircle: hasCircle },
            list.regions,
          ),
          proposal: proposeRegions(z.name, list.regions),
        };
      }),
    };
  }

  async create(
    ctx: TenantContext,
    outletId: number,
    dto: CreateDeliveryZoneDto,
  ) {
    await this.assertOutletBelongsToShop(ctx, outletId);
    const regionIds =
      dto.regionIds !== undefined
        ? await this.regionsService.resolveManyForShop(
            ctx.shopId,
            dto.regionIds,
          )
        : undefined;
    // Choosing regions, or placing the circle, IS the merchant's decision about
    // what this zone covers, so the zone is born confirmed. A zone with neither
    // is left unconfirmed, which keeps a legacy-mode shop in legacy mode.
    const confirmed =
      (regionIds?.length ?? 0) > 0 ||
      hasPlacedCircle({
        name: '',
        isActive: true,
        lat: dto.lat ?? null,
        lng: dto.lng ?? null,
        radiusKm: dto.radiusKm ?? null,
      });
    if (!confirmed) {
      // In a shop already matching by region, an unconfirmed active zone would
      // silently drag it back to name matching.
      const { mode } = await getZoneMatchingMode(this.db, ctx.shopId);
      if (mode === 'regions' && (dto.isActive ?? true)) {
        throw new BadRequestException(
          'Choose the regions this zone covers, or place its map circle. This shop matches delivery zones by region.',
        );
      }
    }
    const values = [
      outletId,
      dto.name,
      dto.fee,
      dto.minOrderAmount ?? 0,
      dto.isActive ?? true,
      dto.lat ?? null,
      dto.lng ?? null,
      dto.radiusKm ?? null,
      confirmed ? new Date() : null,
    ];
    const insertSql = `INSERT INTO deliveryzone (outletId, name, fee, minOrderAmount, isActive, lat, lng, radiusKm, mappingConfirmedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    let zoneId: number;
    if (regionIds && regionIds.length > 0) {
      zoneId = await this.db.transaction(async (conn) => {
        const [res] = await conn.query(insertSql, values);
        const id = (res as { insertId: number }).insertId;
        await this.replaceZoneRegions(conn, id, regionIds);
        return id;
      });
    } else {
      zoneId = (await this.db.execute(insertSql, values)).insertId;
    }
    return this.findZoneById(zoneId);
  }

  async update(
    ctx: TenantContext,
    outletId: number,
    zoneId: number,
    dto: UpdateDeliveryZoneDto,
  ) {
    await this.assertOutletBelongsToShop(ctx, outletId);
    await this.assertZoneBelongsToOutlet(zoneId, outletId);
    const current = (await this.loadZoneRow(zoneId)) as ZoneRow | undefined;

    const regionIds =
      dto.regionIds !== undefined
        ? await this.regionsService.resolveManyForShop(
            ctx.shopId,
            dto.regionIds,
          )
        : undefined;

    // Saving a region set is the merchant's review of the zone. An empty set is
    // only meaningful for a zone whose circle is placed (it then matches by
    // location alone); otherwise it would match nothing at all.
    let confirmNow = false;
    if (regionIds !== undefined) {
      const effective = {
        name: '',
        isActive: true,
        lat: dto.lat !== undefined ? dto.lat : (current?.lat ?? null),
        lng: dto.lng !== undefined ? dto.lng : (current?.lng ?? null),
        radiusKm:
          dto.radiusKm !== undefined
            ? dto.radiusKm
            : (current?.radiusKm ?? null),
      };
      if (regionIds.length === 0 && !hasPlacedCircle(effective)) {
        throw new BadRequestException(
          'A zone needs at least one region, or a placed map circle',
        );
      }
      confirmNow = true;
    }

    // Turning on a zone nobody has reviewed, in a shop already matching by
    // region, would silently flip the whole shop back to name matching.
    if (
      dto.isActive === true &&
      current &&
      !current.isActive &&
      current.mappingConfirmedAt === null &&
      !confirmNow
    ) {
      const { mode } = await getZoneMatchingMode(this.db, ctx.shopId);
      if (mode === 'regions') {
        throw new ConflictException(
          "Review this zone's regions before turning it on. This shop matches delivery zones by region.",
        );
      }
    }

    const set = buildSetClause({
      name: dto.name,
      fee: dto.fee,
      minOrderAmount: dto.minOrderAmount,
      isActive: dto.isActive,
      lat: dto.lat,
      lng: dto.lng,
      radiusKm: dto.radiusKm,
      mappingConfirmedAt: confirmNow ? new Date() : undefined,
    });
    if (regionIds !== undefined) {
      await this.db.transaction(async (conn) => {
        await this.replaceZoneRegions(conn, zoneId, regionIds);
        if (set) {
          await conn.query(
            `UPDATE deliveryzone SET ${set.setClause} WHERE id = ?`,
            [...set.params, zoneId],
          );
        }
      });
    } else if (set) {
      await this.db.execute(
        `UPDATE deliveryzone SET ${set.setClause} WHERE id = ?`,
        [...set.params, zoneId],
      );
    }
    return this.findZoneById(zoneId);
  }

  // The review screen's "Confirm": save the zone's region set and mark it
  // reviewed, in one step, and leave a trail. Changing how a live shop's
  // deliveries are priced is exactly the kind of action the audit log is for.
  async setMapping(
    ctx: TenantContext,
    outletId: number,
    zoneId: number,
    dto: SetZoneMappingDto,
  ) {
    await this.assertOutletBelongsToShop(ctx, outletId);
    await this.assertZoneBelongsToOutlet(zoneId, outletId);
    const current = (await this.loadZoneRow(zoneId)) as ZoneRow;
    const regionIds = await this.regionsService.resolveManyForShop(
      ctx.shopId,
      dto.regionIds,
    );
    if (regionIds.length === 0 && !hasPlacedCircle(current)) {
      throw new BadRequestException(
        'A zone needs at least one region, or a placed map circle',
      );
    }
    const before = (await this.withRegions([current]))[0].regions.map(
      (r) => r.id,
    );
    await this.db.transaction(async (conn) => {
      await this.replaceZoneRegions(conn, zoneId, regionIds);
      await conn.query(
        `UPDATE deliveryzone SET mappingConfirmedAt = ? WHERE id = ?`,
        [new Date(), zoneId],
      );
    });
    await this.auditLogService.logCtx(ctx, {
      action: 'delivery_zone.mapping_confirmed',
      entityType: 'deliveryzone',
      entityId: zoneId,
      before: {
        regionIds: before,
        confirmed: current.mappingConfirmedAt !== null,
      },
      after: { regionIds, confirmed: true },
    });
    return this.findZoneById(zoneId);
  }

  async remove(ctx: TenantContext, outletId: number, zoneId: number) {
    await this.assertOutletBelongsToShop(ctx, outletId);
    await this.assertZoneBelongsToOutlet(zoneId, outletId);
    await this.db.execute(`DELETE FROM deliveryzone WHERE id = ?`, [zoneId]);
    return { id: zoneId, deleted: true };
  }

  private async replaceZoneRegions(
    conn: {
      query: (sql: string, params?: unknown[]) => Promise<unknown>;
    },
    zoneId: number,
    regionIds: number[],
  ) {
    await conn.query(`DELETE FROM deliveryzoneregion WHERE zoneId = ?`, [
      zoneId,
    ]);
    if (regionIds.length > 0) {
      await conn.query(
        `INSERT INTO deliveryzoneregion (zoneId, regionId) VALUES ${regionIds
          .map(() => '(?, ?)')
          .join(', ')}`,
        regionIds.flatMap((regionId) => [zoneId, regionId]),
      );
    }
  }

  // Adds `regions: [{id, code, nameEn, nameAr}]` to each zone, in one query.
  private async withRegions(zones: ZoneRow[]) {
    const byZone = new Map<number, RegionSummary[]>();
    if (zones.length > 0) {
      const rows = await this.db.query<
        ({ zoneId: number } & RegionSummary & RowDataPacket)[]
      >(
        `SELECT dzr.zoneId, r.id, r.code, r.nameEn, r.nameAr
           FROM deliveryzoneregion dzr JOIN region r ON r.id = dzr.regionId
          WHERE dzr.zoneId IN (${zones.map(() => '?').join(', ')})
          ORDER BY r.sortOrder, r.id`,
        zones.map((z) => z.id),
      );
      for (const row of rows) {
        const list = byZone.get(row.zoneId) ?? [];
        list.push({
          id: row.id,
          code: row.code,
          nameEn: row.nameEn,
          nameAr: row.nameAr,
        });
        byZone.set(row.zoneId, list);
      }
    }
    return zones.map((z) => ({ ...z, regions: byZone.get(z.id) ?? [] }));
  }

  private async loadZoneRow(id: number) {
    const rows = await this.db.query<ZoneRow[]>(
      `SELECT * FROM deliveryzone WHERE id = ?`,
      [id],
    );
    return rows[0];
  }

  private async findZoneById(id: number) {
    const row = await this.loadZoneRow(id);
    return row ? (await this.withRegions([row]))[0] : row;
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
