import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOutletDto } from './dto/create-outlet.dto';
import { UpdateOutletDto } from './dto/update-outlet.dto';
import { computeIsOpen } from './outlet-status';
import { geocodeAddress } from '../common/nominatim';
import type { TenantContext } from '../common/tenant-context';
import type { outlet as OutletModel } from '@prisma/client';

@Injectable()
export class OutletsService {
  constructor(private readonly prisma: PrismaService) {}

  // Admin sees every outlet in the shop (for the switcher / management
  // page). A branch user only ever sees their own outlet — same
  // outlet-override rule as everywhere else, applied here so a branch
  // account can't enumerate its siblings even read-only.
  async findAll(ctx: TenantContext) {
    const [outlets, shop] = await Promise.all([
      this.prisma.outlet.findMany({
        where: {
          shopId: ctx.shopId,
          ...(ctx.role === 'branch' && { id: ctx.outletId! }),
        },
        orderBy: { id: 'asc' },
      }),
      this.prisma.shop.findUniqueOrThrow({
        where: { id: ctx.shopId },
        select: { timezone: true },
      }),
    ]);
    return outlets.map((o) => this.withComputedStatus(o, shop.timezone));
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
    const [outlet, shop] = await Promise.all([
      this.prisma.outlet.findFirst({ where: { id, shopId: ctx.shopId } }),
      this.prisma.shop.findUniqueOrThrow({
        where: { id: ctx.shopId },
        select: { timezone: true },
      }),
    ]);
    if (!outlet) {
      throw new NotFoundException(`Outlet ${id} not found`);
    }
    return this.withComputedStatus(outlet, shop.timezone);
  }

  create(ctx: TenantContext, dto: CreateOutletDto) {
    this.validateDelivery(
      dto.deliveryEnabled ?? false,
      dto.deliveryRadiusKm,
      dto.latitude,
      dto.longitude,
    );
    const closedOverride = dto.closedOverride ?? false;
    return this.prisma.outlet.create({
      data: {
        shopId: ctx.shopId,
        name: dto.name,
        nameAr: dto.nameAr,
        email: dto.email,
        whatsapp: dto.whatsapp,
        active: dto.active ?? true,
        emirate: dto.emirate,
        area: dto.area,
        phone: dto.phone,
        latitude: dto.latitude,
        longitude: dto.longitude,
        businessHours: dto.businessHours,
        closedOverride,
        // Stamped here, not accepted from the client — see outlet-status.ts
        // for how this drives the next-day auto-expiry.
        closedOverrideSetAt: closedOverride ? new Date() : null,
        pickupEnabled: dto.pickupEnabled ?? false,
        deliveryEnabled: dto.deliveryEnabled ?? false,
        deliveryRadiusKm: dto.deliveryRadiusKm,
      },
    });
  }

  async update(ctx: TenantContext, id: number, dto: UpdateOutletDto) {
    const current = await this.assertBelongsToShop(ctx, id);

    this.validateDelivery(
      dto.deliveryEnabled ?? current.deliveryEnabled,
      dto.deliveryRadiusKm !== undefined ? dto.deliveryRadiusKm : current.deliveryRadiusKm,
      dto.latitude !== undefined ? dto.latitude : current.latitude,
      dto.longitude !== undefined ? dto.longitude : current.longitude,
    );

    return this.prisma.outlet.update({
      where: { id },
      data: {
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
        businessHours: dto.businessHours,
        closedOverride: dto.closedOverride,
        // Re-stamped every time this request turns the override on (even if
        // it was already on) — flipping it is "today" by definition of the
        // action. Cleared when explicitly turned off. Left untouched (Prisma
        // skips `undefined` fields) when this update doesn't mention it.
        ...(dto.closedOverride !== undefined && {
          closedOverrideSetAt: dto.closedOverride ? new Date() : null,
        }),
        pickupEnabled: dto.pickupEnabled,
        deliveryEnabled: dto.deliveryEnabled,
        deliveryRadiusKm: dto.deliveryRadiusKm,
      },
    });
  }

  async remove(ctx: TenantContext, id: number) {
    await this.assertBelongsToShop(ctx, id);

    const [orderCount, userCount] = await this.prisma.$transaction([
      this.prisma.order.count({ where: { outletId: id } }),
      this.prisma.user.count({ where: { outletId: id } }),
    ]);
    if (orderCount > 0 || userCount > 0) {
      throw new ConflictException(
        `Cannot delete: this outlet has ${orderCount} order${orderCount === 1 ? '' : 's'} and ${userCount} assigned user${userCount === 1 ? '' : 's'}. Reassign or remove them first.`,
      );
    }

    // outletstock rows cascade on delete — an outlet with no orders/users
    // but existing stock rows is safe to remove outright.
    await this.prisma.outlet.delete({ where: { id } });
    return { id, deleted: true };
  }

  // This is a manual, merchant-triggered lookup (not autocomplete-as-you-type),
  // so it stays well within Nominatim's free-tier rate limit without needing
  // extra throttling. See common/nominatim.ts for the proxy rationale.
  async geocode(query?: string) {
    return geocodeAddress(query);
  }

  // Admin-only endpoints (create/update/remove are gated by @Roles('admin')
  // at the controller) still only need the shop boundary, never the branch
  // one — an admin manages every outlet in their own shop.
  private async assertBelongsToShop(ctx: TenantContext, id: number) {
    const outlet = await this.prisma.outlet.findFirst({
      where: { id, shopId: ctx.shopId },
    });
    if (!outlet) {
      throw new NotFoundException(`Outlet ${id} not found`);
    }
    return outlet;
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
    if (deliveryRadiusKm === undefined || deliveryRadiusKm === null || deliveryRadiusKm <= 0) {
      throw new BadRequestException('Delivery radius (km) is required when delivery is enabled');
    }
    if (latitude === undefined || latitude === null || longitude === undefined || longitude === null) {
      throw new BadRequestException(
        'Outlet coordinates are required when delivery is enabled',
      );
    }
  }

  private withComputedStatus(outlet: OutletModel, timezone: string) {
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
