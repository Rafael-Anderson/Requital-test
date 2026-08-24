import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../database/database.service';
import { buildSetClause } from '../database/update.util';
import type { OutletRow } from '../db/types';
import { CreateOutletDto } from './dto/create-outlet.dto';
import { UpdateOutletDto } from './dto/update-outlet.dto';
import { UpdateOutletStatusDto } from './dto/update-outlet-status.dto';
import { computeIsOpen } from './outlet-status';
import { geocodeAddress, reverseGeocodeAddress } from '../common/nominatim';
import type { TenantContext } from '../common/tenant-context';
import { BranchRolesService } from '../branch-roles/branch-roles.service';

@Injectable()
export class OutletsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly branchRolesService: BranchRolesService,
  ) {}

  // Admin sees every outlet in the shop (for the switcher / management
  // page). A branch user only ever sees their own outlet — same
  // outlet-override rule as everywhere else, applied here so a branch
  // account can't enumerate its siblings even read-only. The permission
  // check only applies to the branch case: an admin listing every outlet
  // is inherently an aggregate view (no single outlet in play), same
  // aggregate-ignores-overrides reasoning as Dashboard.
  async findAll(ctx: TenantContext) {
    if (ctx.role === 'branch') {
      await this.branchRolesService.assertPermission(
        ctx,
        ctx.outletId!,
        'outlets.view_own',
      );
    }
    const conditions = ['shopId = ?'];
    const params: (string | number)[] = [ctx.shopId];
    if (ctx.role === 'branch') {
      conditions.push('id = ?');
      params.push(ctx.outletId!);
    }
    const [outlets, shopRows] = await Promise.all([
      this.db.query<(OutletRow & RowDataPacket)[]>(
        `SELECT * FROM outlet WHERE ${conditions.join(' AND ')} ORDER BY id ASC`,
        params,
      ),
      this.db.query<RowDataPacket[]>(`SELECT timezone FROM shop WHERE id = ?`, [
        ctx.shopId,
      ]),
    ]);
    const timezone = shopRows[0].timezone as string;
    return outlets.map((o) => this.withComputedStatus(o, timezone));
  }

  async findOne(ctx: TenantContext, id: number) {
    // A branch user asking for any id other than their own outlet must get
    // a 404, not a substitution — writing this as a plain `id` key in the
    // where object below and then spreading `{ id: ctx.outletId }` after it
    // would silently overwrite the requested id with the caller's own
    // (object spread, last key wins), turning "not found" into "here's your
    // own outlet instead." Checked explicitly up front instead.
    if (ctx.role === 'branch' && id !== ctx.outletId) {
      throw new NotFoundException(`Outlet ${id} not found`);
    }
    // Always checked (never skipped) — unlike findAll, this is always a
    // single concrete outlet, whether the caller is admin or branch.
    await this.branchRolesService.assertPermission(ctx, id, 'outlets.view_own');
    const [outletRows, shopRows] = await Promise.all([
      this.db.query<(OutletRow & RowDataPacket)[]>(
        `SELECT * FROM outlet WHERE id = ? AND shopId = ?`,
        [id, ctx.shopId],
      ),
      this.db.query<RowDataPacket[]>(`SELECT timezone FROM shop WHERE id = ?`, [
        ctx.shopId,
      ]),
    ]);
    const outlet = outletRows[0];
    if (!outlet) {
      throw new NotFoundException(`Outlet ${id} not found`);
    }
    return this.withComputedStatus(outlet, shopRows[0].timezone as string);
  }

  async create(ctx: TenantContext, dto: CreateOutletDto) {
    this.validateDelivery(
      dto.deliveryEnabled ?? false,
      dto.deliveryRadiusKm,
      dto.latitude,
      dto.longitude,
    );
    const closedOverride = dto.closedOverride ?? false;
    const result = await this.db.execute(
      `INSERT INTO outlet (
        shopId, name, nameAr, email, whatsapp, active, emirate, area, phone,
        latitude, longitude, businessHours, closedOverride, closedOverrideSetAt,
        pickupEnabled, deliveryEnabled, deliveryRadiusKm
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ctx.shopId,
        dto.name,
        dto.nameAr ?? null,
        dto.email ?? null,
        dto.whatsapp ?? null,
        dto.active ?? true,
        dto.emirate ?? null,
        dto.area ?? null,
        dto.phone ?? null,
        dto.latitude ?? null,
        dto.longitude ?? null,
        dto.businessHours ? JSON.stringify(dto.businessHours) : null,
        closedOverride,
        // Stamped here, not accepted from the client — see outlet-status.ts
        // for how this drives the next-day auto-expiry.
        closedOverride ? new Date() : null,
        dto.pickupEnabled ?? false,
        dto.deliveryEnabled ?? false,
        dto.deliveryRadiusKm ?? null,
      ],
    );
    const rows = await this.db.query<(OutletRow & RowDataPacket)[]>(
      `SELECT * FROM outlet WHERE id = ?`,
      [result.insertId],
    );
    return rows[0];
  }

  async update(ctx: TenantContext, id: number, dto: UpdateOutletDto) {
    const current = await this.assertBelongsToShop(ctx, id);

    this.validateDelivery(
      dto.deliveryEnabled ?? current.deliveryEnabled,
      dto.deliveryRadiusKm !== undefined
        ? dto.deliveryRadiusKm
        : current.deliveryRadiusKm,
      dto.latitude !== undefined ? dto.latitude : current.latitude,
      dto.longitude !== undefined ? dto.longitude : current.longitude,
    );

    const set = buildSetClause({
      name: dto.name,
      nameAr: dto.nameAr,
      email: dto.email,
      whatsapp: dto.whatsapp,
      active: dto.active,
      emirate: dto.emirate,
      area: dto.area,
      phone: dto.phone,
      latitude: dto.latitude,
      longitude: dto.longitude,
      businessHours:
        dto.businessHours !== undefined
          ? JSON.stringify(dto.businessHours)
          : undefined,
      closedOverride: dto.closedOverride,
      // Re-stamped every time this request turns the override on (even if
      // it was already on) — flipping it is "today" by definition of the
      // action. Cleared when explicitly turned off. Left untouched (omitted
      // from the SET clause) when this update doesn't mention it.
      ...(dto.closedOverride !== undefined && {
        closedOverrideSetAt: dto.closedOverride ? new Date() : null,
      }),
      pickupEnabled: dto.pickupEnabled,
      deliveryEnabled: dto.deliveryEnabled,
      deliveryRadiusKm: dto.deliveryRadiusKm,
    });
    if (set) {
      await this.db.execute(`UPDATE outlet SET ${set.setClause} WHERE id = ?`, [
        ...set.params,
        id,
      ]);
    }
    const rows = await this.db.query<(OutletRow & RowDataPacket)[]>(
      `SELECT * FROM outlet WHERE id = ?`,
      [id],
    );
    return rows[0];
  }

  // Branch Status tab's write path — deliberately narrower than update()
  // above: only the two accepting-orders toggles, reachable by
  // branch/order_manager (not just admin), never touching the rest of the
  // outlet record. A branch user may only flip their OWN outlet — checked
  // explicitly here (id !== ctx.outletId), not via a spread that could
  // silently be overwritten last, per the documented outlets.service.ts
  // gotcha (see CLAUDE.md's "Tenant isolation" section). An admin/
  // order_manager isn't outlet-pinned, so the shop-boundary check in
  // assertBelongsToShop is sufficient for them.
  async updateStatus(ctx: TenantContext, id: number, dto: UpdateOutletStatusDto) {
    const current = await this.assertBelongsToShop(ctx, id);
    if (ctx.role === 'branch' && id !== ctx.outletId) {
      throw new NotFoundException(`Outlet ${id} not found`);
    }

    this.validateDelivery(
      dto.deliveryEnabled ?? current.deliveryEnabled,
      current.deliveryRadiusKm,
      current.latitude,
      current.longitude,
    );

    const set = buildSetClause({
      pickupEnabled: dto.pickupEnabled,
      deliveryEnabled: dto.deliveryEnabled,
    });
    if (set) {
      await this.db.execute(`UPDATE outlet SET ${set.setClause} WHERE id = ?`, [
        ...set.params,
        id,
      ]);
    }
    const rows = await this.db.query<(OutletRow & RowDataPacket)[]>(
      `SELECT * FROM outlet WHERE id = ?`,
      [id],
    );
    return rows[0];
  }

  async remove(ctx: TenantContext, id: number) {
    await this.assertBelongsToShop(ctx, id);

    const [orderRows, userRows] = await Promise.all([
      this.db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM \`order\` WHERE outletId = ?`,
        [id],
      ),
      this.db.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS c FROM user WHERE outletId = ?`,
        [id],
      ),
    ]);
    const orderCount = Number(orderRows[0].c);
    const userCount = Number(userRows[0].c);
    if (orderCount > 0 || userCount > 0) {
      throw new ConflictException(
        `Cannot delete: this outlet has ${orderCount} order${orderCount === 1 ? '' : 's'} and ${userCount} assigned user${userCount === 1 ? '' : 's'}. Reassign or remove them first.`,
      );
    }

    // outletstock rows cascade on delete — an outlet with no orders/users
    // but existing stock rows is safe to remove outright.
    await this.db.execute(`DELETE FROM outlet WHERE id = ?`, [id]);
    return { id, deleted: true };
  }

  // This is a manual, merchant-triggered lookup (not autocomplete-as-you-type),
  // so it stays well within Nominatim's free-tier rate limit without needing
  // extra throttling. See common/nominatim.ts for the proxy rationale.
  async geocode(query?: string) {
    return geocodeAddress(query);
  }

  // Pin-drag reverse lookup for MapPicker — same manual-trigger rate-limit
  // reasoning as geocode() above (dragend fires once per drag, not per pixel).
  async reverseGeocode(lat?: number, lon?: number) {
    return reverseGeocodeAddress(lat, lon);
  }

  // Admin-only endpoints (create/update/remove are gated by @Roles('admin')
  // at the controller) still only need the shop boundary, never the branch
  // one — an admin manages every outlet in their own shop.
  private async assertBelongsToShop(ctx: TenantContext, id: number) {
    const rows = await this.db.query<(OutletRow & RowDataPacket)[]>(
      `SELECT * FROM outlet WHERE id = ? AND shopId = ?`,
      [id, ctx.shopId],
    );
    if (rows.length === 0) {
      throw new NotFoundException(`Outlet ${id} not found`);
    }
    return rows[0];
  }

  // A radius is meaningless without a center point, so both are required
  // together whenever delivery is turned on — checked against the merged
  // (existing + incoming) state, not just whatever this request happens to
  // include.
  private validateDelivery(
    deliveryEnabled: boolean,
    deliveryRadiusKm: number | null | undefined,
    latitude: number | null | undefined,
    longitude: number | null | undefined,
  ) {
    if (!deliveryEnabled) return;
    if (
      deliveryRadiusKm === undefined ||
      deliveryRadiusKm === null ||
      deliveryRadiusKm <= 0
    ) {
      throw new BadRequestException(
        'Delivery radius (km) is required when delivery is enabled',
      );
    }
    if (
      latitude === undefined ||
      latitude === null ||
      longitude === undefined ||
      longitude === null
    ) {
      throw new BadRequestException(
        'Outlet coordinates are required when delivery is enabled',
      );
    }
  }

  private withComputedStatus(outlet: OutletRow, timezone: string) {
    return {
      ...outlet,
      isOpen: computeIsOpen(
        outlet.businessHours,
        outlet.closedOverride,
        outlet.closedOverrideSetAt,
        timezone,
      ),
    };
  }
}
