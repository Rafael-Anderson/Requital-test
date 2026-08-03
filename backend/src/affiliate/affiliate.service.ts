import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
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
  constructor(private readonly prisma: PrismaService) {}

  // ---------- Affiliate tab ----------

  async getSummary(ctx: TenantContext) {
    const [
      totalCode,
      totalAffiliate,
      activeAffiliate,
      codesByStatus,
      pendingOrders,
      approvedOrders,
    ] = await Promise.all([
      this.prisma.affiliatecode.count({ where: { shopId: ctx.shopId } }),
      this.prisma.affiliate.count({ where: { shopId: ctx.shopId } }),
      this.prisma.affiliate.count({
        where: { shopId: ctx.shopId, status: 'active' },
      }),
      this.prisma.affiliatecode.groupBy({
        by: ['status'],
        where: { shopId: ctx.shopId },
        _count: true,
      }),
      this.prisma.affiliateorder.count({
        where: { shopId: ctx.shopId, status: 'pending' },
      }),
      this.prisma.affiliateorder.findMany({
        where: { shopId: ctx.shopId, status: 'approved' },
        select: { order: { select: { total: true } } },
      }),
    ]);

    const codeStatus = { approved: 0, pending: 0, blocked: 0 };
    for (const row of codesByStatus) {
      if (row.status in codeStatus)
        codeStatus[row.status as keyof typeof codeStatus] = row._count;
    }

    return {
      totalCode,
      totalAffiliate,
      activeAffiliate,
      pendingOrders,
      // Revenue driven through approved affiliate orders (order totals, not
      // commission payable — the per-order commission owed is shown on the
      // Affiliate Orders tab instead).
      approvedOrderRevenue: approvedOrders.reduce(
        (sum, r) => sum + Number(r.order.total),
        0,
      ),
      codeStatus,
    };
  }

  async findAllAffiliates(ctx: TenantContext, query: ListQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const search = query.search?.trim();
    const where: Prisma.affiliateWhereInput = {
      shopId: ctx.shopId,
      ...(search && {
        OR: [{ name: { contains: search } }, { mobile: { contains: search } }],
      }),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.affiliate.findMany({
        where,
        include: {
          affiliatecode: {
            include: { _count: { select: { affiliateorder: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.affiliate.count({ where }),
    ]);

    return {
      data: rows.map((a) => ({
        id: a.id,
        name: a.name,
        mobile: a.mobile,
        status: a.status,
        createdAt: a.createdAt,
        codesCount: a.affiliatecode.length,
        ordersCount: a.affiliatecode.reduce(
          (sum, c) => sum + c._count.affiliateorder,
          0,
        ),
      })),
      page,
      pageSize,
      total,
    };
  }

  async createAffiliate(ctx: TenantContext, dto: CreateAffiliateDto) {
    return this.prisma.affiliate.create({
      data: { shopId: ctx.shopId, name: dto.name, mobile: dto.mobile },
    });
  }

  async updateAffiliate(
    ctx: TenantContext,
    id: number,
    dto: UpdateAffiliateDto,
  ) {
    await this.assertAffiliateBelongsToShop(ctx, id);
    return this.prisma.affiliate.update({
      where: { id },
      data: { name: dto.name, mobile: dto.mobile, status: dto.status },
    });
  }

  // ---------- Affiliate Codes tab ----------

  async findAllCodes(ctx: TenantContext, query: ListQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const search = query.search?.trim();
    const where: Prisma.affiliatecodeWhereInput = {
      shopId: ctx.shopId,
      ...(search && {
        OR: [
          { code: { contains: search } },
          { promotionFor: { contains: search } },
        ],
      }),
    };

    const shop = await this.prisma.shop.findUniqueOrThrow({
      where: { id: ctx.shopId },
      select: { subdomain: true },
    });
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.affiliatecode.findMany({
        where,
        include: {
          affiliate: { select: { name: true } },
          _count: { select: { affiliateorder: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.affiliatecode.count({ where }),
    ]);

    return {
      data: rows.map((c) => ({
        id: c.id,
        code: c.code,
        affiliateId: c.affiliateId,
        affiliateName: c.affiliate.name,
        promotionFor: c.promotionFor,
        url: `${STOREFRONT_URL}/${shop.subdomain}?ref=${c.code}`,
        status: c.status,
        commissionType: c.commissionType,
        commissionValue: Number(c.commissionValue),
        validFrom: c.validFrom,
        validUntil: c.validUntil,
        ordersCount: c._count.affiliateorder,
        createdAt: c.createdAt,
      })),
      page,
      pageSize,
      total,
    };
  }

  async createCode(ctx: TenantContext, dto: CreateAffiliateCodeDto) {
    const affiliate = await this.prisma.affiliate.findFirst({
      where: { id: dto.affiliateId, shopId: ctx.shopId },
    });
    if (!affiliate) {
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
      return await this.prisma.affiliatecode.create({
        data: {
          shopId: ctx.shopId,
          affiliateId: dto.affiliateId,
          code: dto.code,
          promotionFor: dto.promotionFor ?? 'All Products',
          commissionType: dto.commissionType,
          commissionValue: dto.commissionValue,
          validFrom: dto.validFrom ? new Date(dto.validFrom) : undefined,
          validUntil: dto.validUntil ? new Date(dto.validUntil) : undefined,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
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
    return this.prisma.affiliatecode.update({
      where: { id },
      data: {
        promotionFor: dto.promotionFor,
        status: dto.status,
        commissionType: dto.commissionType,
        commissionValue: dto.commissionValue,
        validFrom: dto.validFrom ? new Date(dto.validFrom) : undefined,
        validUntil: dto.validUntil ? new Date(dto.validUntil) : undefined,
      },
    });
  }

  // ---------- Affiliate Orders tab ----------

  async findAllOrders(ctx: TenantContext, query: ListQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.affiliateorder.findMany({
        where: { shopId: ctx.shopId },
        include: {
          order: { select: { id: true, customerName: true, total: true } },
          affiliatecode: {
            select: { code: true, affiliate: { select: { name: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.affiliateorder.count({ where: { shopId: ctx.shopId } }),
    ]);

    return {
      data: rows.map((r) => ({
        id: r.id,
        orderId: r.order.id,
        customerName: r.order.customerName,
        orderTotal: Number(r.order.total),
        code: r.affiliatecode.code,
        affiliateName: r.affiliatecode.affiliate.name,
        commissionAmount: Number(r.commissionAmount),
        status: r.status,
        createdAt: r.createdAt,
      })),
      page,
      pageSize,
      total,
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
    const row = await this.prisma.affiliateorder.findFirst({
      where: { id, shopId: ctx.shopId },
    });
    if (!row) {
      throw new NotFoundException(`Affiliate order ${id} not found`);
    }
    if (row.status !== 'pending') {
      throw new BadRequestException(
        `Cannot change status — commission is already '${row.status}'`,
      );
    }
    return this.prisma.affiliateorder.update({
      where: { id },
      data: { status: dto.status },
    });
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

    const row = await this.prisma.affiliatecode.findUnique({
      where: { shopId_code: { shopId, code: trimmed } },
    });
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

  // Called inside the same transaction that creates the order, so attribution
  // can never exist without the order it's attributed to (or vice versa).
  async recordAttribution(
    tx: Prisma.TransactionClient,
    shopId: number,
    orderId: number,
    attribution: { affiliateCodeId: number; commissionAmount: number },
  ) {
    await tx.affiliateorder.create({
      data: {
        shopId,
        orderId,
        affiliateCodeId: attribution.affiliateCodeId,
        commissionAmount: attribution.commissionAmount,
      },
    });
  }

  // Auto-sync from the order's own lifecycle — called from
  // OrdersService.updateStatus/cancel and PaymentsService.handleWebhook.
  // Safe no-op if the order has no affiliate attribution at all (updateMany
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
    await this.prisma.affiliateorder.updateMany({
      where: { orderId, status: 'pending' },
      data: { status: nextStatus },
    });
  }

  private async assertAffiliateBelongsToShop(ctx: TenantContext, id: number) {
    const affiliate = await this.prisma.affiliate.findFirst({
      where: { id, shopId: ctx.shopId },
    });
    if (!affiliate) {
      throw new NotFoundException(`Affiliate ${id} not found`);
    }
    return affiliate;
  }

  private async assertCodeBelongsToShop(ctx: TenantContext, id: number) {
    const code = await this.prisma.affiliatecode.findFirst({
      where: { id, shopId: ctx.shopId },
    });
    if (!code) {
      throw new NotFoundException(`Affiliate code ${id} not found`);
    }
    return code;
  }
}
