import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDeliveryZoneDto } from './dto/create-delivery-zone.dto';
import { UpdateDeliveryZoneDto } from './dto/update-delivery-zone.dto';
import type { TenantContext } from '../common/tenant-context';
import { BranchRolesService } from '../branch-roles/branch-roles.service';

// Additive to (not replacing) the radius-based deliveryRadiusKm on the
// outlet — named flat-fee zones for merchants who want per-area pricing
// instead of, or alongside, a single radius.
@Injectable()
export class DeliveryZonesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchRolesService: BranchRolesService,
  ) {}

  async findAll(ctx: TenantContext, outletId: number) {
    await this.assertOutletAccessible(ctx, outletId);
    return this.prisma.deliveryzone.findMany({
      where: { outletId },
      orderBy: { id: 'asc' },
    });
  }

  async create(
    ctx: TenantContext,
    outletId: number,
    dto: CreateDeliveryZoneDto,
  ) {
    await this.assertOutletBelongsToShop(ctx, outletId);
    return this.prisma.deliveryzone.create({
      data: {
        outletId,
        name: dto.name,
        fee: dto.fee,
        minOrderAmount: dto.minOrderAmount ?? 0,
        isActive: dto.isActive ?? true,
      },
    });
  }

  async update(
    ctx: TenantContext,
    outletId: number,
    zoneId: number,
    dto: UpdateDeliveryZoneDto,
  ) {
    await this.assertOutletBelongsToShop(ctx, outletId);
    await this.assertZoneBelongsToOutlet(zoneId, outletId);
    return this.prisma.deliveryzone.update({
      where: { id: zoneId },
      data: dto,
    });
  }

  async remove(ctx: TenantContext, outletId: number, zoneId: number) {
    await this.assertOutletBelongsToShop(ctx, outletId);
    await this.assertZoneBelongsToOutlet(zoneId, outletId);
    await this.prisma.deliveryzone.delete({ where: { id: zoneId } });
    return { id: zoneId, deleted: true };
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
    const outlet = await this.prisma.outlet.findFirst({
      where: { id: outletId, shopId: ctx.shopId },
    });
    if (!outlet) {
      throw new NotFoundException(`Outlet ${outletId} not found`);
    }
  }

  // A zoneId that belongs to a *different* outlet than the one in the URL
  // must 404, not silently operate on the wrong outlet's zone.
  private async assertZoneBelongsToOutlet(zoneId: number, outletId: number) {
    const zone = await this.prisma.deliveryzone.findFirst({
      where: { id: zoneId, outletId },
    });
    if (!zone) {
      throw new NotFoundException(`Delivery zone ${zoneId} not found`);
    }
  }
}
