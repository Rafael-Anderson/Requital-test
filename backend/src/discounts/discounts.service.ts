import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../common/tenant-context';
import { CreateDiscountDto } from './dto/create-discount.dto';
import { UpdateDiscountDto } from './dto/update-discount.dto';
import { ValidateDiscountDto } from './dto/validate-discount.dto';
import {
  DISCOUNT_REJECTION_MESSAGES,
  DiscountRejectionReason,
  DiscountType,
} from './discount-constants';
import { AuditLogService } from '../audit-log/audit-log.service';

const discountInclude = {
  discountproduct: { include: { product: { select: { id: true, name: true } } } },
  discountcategory: { include: { category: { select: { id: true, name: true } } } },
} satisfies Prisma.discountInclude;

type DiscountWithEligibility = Prisma.discountGetPayload<{ include: typeof discountInclude }>;

export interface EvaluateResult {
  valid: boolean;
  reason?: DiscountRejectionReason;
  message?: string;
  discountId?: number;
  code?: string;
  type?: DiscountType;
  discountAmount?: number;
  freeShipping?: boolean;
}

@Injectable()
export class DiscountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async findAll(ctx: TenantContext) {
    const discounts = await this.prisma.discount.findMany({
      where: { shopId: ctx.shopId },
      include: discountInclude,
      orderBy: { id: 'desc' },
    });
    return discounts.map((d) => this.toResponse(d));
  }

  async findOne(ctx: TenantContext, id: number) {
    const discount = await this.prisma.discount.findFirst({
      where: { id, shopId: ctx.shopId },
      include: discountInclude,
    });
    if (!discount) {
      throw new NotFoundException(`Discount ${id} not found`);
    }
    return this.toResponse(discount);
  }

  async create(ctx: TenantContext, dto: CreateDiscountDto) {
    this.assertFieldsMatchType(dto);
    await this.assertEligibilityTargetsBelongToShop(ctx, dto);

    try {
      const discount = await this.prisma.discount.create({
        data: {
          shopId: ctx.shopId,
          code: this.normalizeCode(dto.code),
          type: dto.type,
          value: dto.type === 'FREE_SHIPPING' ? undefined : dto.value,
          minPurchaseAmount: dto.minPurchaseAmount,
          appliesTo: dto.appliesTo ?? 'ALL_PRODUCTS',
          usageLimit: dto.usageLimit,
          usageLimitPerCustomer: dto.usageLimitPerCustomer,
          startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
          endsAt: dto.endsAt ? new Date(dto.endsAt) : undefined,
          active: dto.active ?? true,
          discountproduct:
            dto.appliesTo === 'SPECIFIC_PRODUCTS' && dto.productIds
              ? { create: dto.productIds.map((productId) => ({ productId })) }
              : undefined,
          discountcategory:
            dto.appliesTo === 'SPECIFIC_CATEGORIES' && dto.categoryIds
              ? { create: dto.categoryIds.map((categoryId) => ({ categoryId })) }
              : undefined,
        },
        include: discountInclude,
      });
      return this.toResponse(discount);
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async update(ctx: TenantContext, id: number, dto: UpdateDiscountDto) {
    const current = await this.findRaw(ctx, id);
    const effectiveType = dto.type ?? (current.type as DiscountType);
    if (dto.type || dto.value !== undefined) {
      this.assertFieldsMatchType({ type: effectiveType, value: dto.value ?? (current.value ? Number(current.value) : undefined) });
    }
    if (dto.productIds || dto.categoryIds) {
      await this.assertEligibilityTargetsBelongToShop(ctx, dto);
    }

    try {
      const discount = await this.prisma.$transaction(async (tx) => {
        if (dto.productIds) {
          await tx.discountproduct.deleteMany({ where: { discountId: id } });
        }
        if (dto.categoryIds) {
          await tx.discountcategory.deleteMany({ where: { discountId: id } });
        }
        return tx.discount.update({
          where: { id },
          data: {
            code: dto.code ? this.normalizeCode(dto.code) : undefined,
            type: dto.type,
            value: effectiveType === 'FREE_SHIPPING' ? null : dto.value,
            minPurchaseAmount: dto.minPurchaseAmount,
            appliesTo: dto.appliesTo,
            usageLimit: dto.usageLimit,
            usageLimitPerCustomer: dto.usageLimitPerCustomer,
            startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
            endsAt: dto.endsAt ? new Date(dto.endsAt) : undefined,
            active: dto.active,
            ...(dto.productIds && {
              discountproduct: { create: dto.productIds.map((productId) => ({ productId })) },
            }),
            ...(dto.categoryIds && {
              discountcategory: { create: dto.categoryIds.map((categoryId) => ({ categoryId })) },
            }),
          },
          include: discountInclude,
        });
      });
      return this.toResponse(discount);
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async remove(ctx: TenantContext, id: number) {
    const discount = await this.findRaw(ctx, id);
    await this.prisma.discount.delete({ where: { id } });
    await this.auditLogService.logCtx(ctx, {
      action: 'discount.deleted',
      entityType: 'discount',
      entityId: id,
      before: { code: discount.code },
    });
    return { id, deleted: true };
  }

  // Full endpoint logic: resolve by code, then evaluate. Used by both
  // POST /shop/discounts/validate (admin-authenticated, draft-order builder)
  // and POST /public/:shopSlug/discounts/validate (storefront cart/checkout
  // — see PublicController) via the same shopId-scoped call.
  async validate(shopId: number, dto: ValidateDiscountDto): Promise<EvaluateResult> {
    const discount = await this.resolveByCode(shopId, dto.code);
    return this.evaluate(discount, dto);
  }

  async resolveByCode(shopId: number, code: string): Promise<DiscountWithEligibility | null> {
    return this.prisma.discount.findUnique({
      where: { shopId_code: { shopId, code: this.normalizeCode(code) } },
      include: discountInclude,
    });
  }

  async resolveById(shopId: number, id: number): Promise<DiscountWithEligibility | null> {
    return this.prisma.discount.findFirst({ where: { id, shopId }, include: discountInclude });
  }

  // Eligibility/amount computation given an already-resolved discount row
  // (or null, for "code not found") — shared by validate() and by
  // OrdersService/PublicService's pre-transaction discount check before
  // order creation. Doesn't touch usage counters — see redeem() for the
  // atomic claim, which happens separately, inside the order's transaction.
  async evaluate(
    discount: DiscountWithEligibility | null,
    input: { cartSubtotal: number; productIds?: number[]; categoryIds?: number[]; customerId?: number },
  ): Promise<EvaluateResult> {
    if (!discount) return this.reject('not_found');
    if (!discount.active) return this.reject('inactive');

    const now = new Date();
    if (discount.startsAt && now < discount.startsAt) return this.reject('not_started');
    if (discount.endsAt && now > discount.endsAt) return this.reject('expired');

    if (discount.minPurchaseAmount && input.cartSubtotal < Number(discount.minPurchaseAmount)) {
      return this.reject('min_purchase_not_met');
    }

    if (discount.usageLimit !== null && discount.timesUsed >= discount.usageLimit) {
      return this.reject('usage_limit_reached');
    }

    if (discount.usageLimitPerCustomer !== null && input.customerId !== undefined) {
      const usedByCustomer = await this.prisma.discountredemption.count({
        where: { discountId: discount.id, customerId: input.customerId },
      });
      if (usedByCustomer >= discount.usageLimitPerCustomer) {
        return this.reject('per_customer_limit_reached');
      }
    }

    if (discount.appliesTo === 'SPECIFIC_PRODUCTS') {
      const eligibleIds = new Set(discount.discountproduct.map((d) => d.productId));
      if (!(input.productIds ?? []).some((id) => eligibleIds.has(id))) {
        return this.reject('not_eligible');
      }
    } else if (discount.appliesTo === 'SPECIFIC_CATEGORIES') {
      const eligibleIds = new Set(discount.discountcategory.map((d) => d.categoryId));
      if (!(input.categoryIds ?? []).some((id) => eligibleIds.has(id))) {
        return this.reject('not_eligible');
      }
    }

    return {
      valid: true,
      discountId: discount.id,
      code: discount.code,
      type: discount.type as DiscountType,
      discountAmount: this.computeAmount(discount, input.cartSubtotal),
      freeShipping: discount.type === 'FREE_SHIPPING',
    };
  }

  // Atomically claims one use — CAS on usageLimit, same WHERE-guarded
  // updateMany idiom as outletstock's stock decrement — then records a
  // redemption row. Must run INSIDE the same transaction that creates the
  // order (see OrdersService.create/PublicService.createOrder): if the CAS
  // fails (limit reached by a concurrent request since evaluate() ran), this
  // throws and the whole order attempt aborts — a discount is never silently
  // dropped from an order that already priced it in.
  async redeem(
    tx: Prisma.TransactionClient,
    discount: { id: number; usageLimit: number | null },
    orderId: number,
    customerId: number | null,
  ) {
    const result = await tx.discount.updateMany({
      where: {
        id: discount.id,
        ...(discount.usageLimit !== null && { timesUsed: { lt: discount.usageLimit } }),
      },
      data: { timesUsed: { increment: 1 } },
    });
    if (result.count === 0) {
      throw new ConflictException('This promo code has just reached its usage limit');
    }
    await tx.discountredemption.create({
      data: { discountId: discount.id, customerId: customerId ?? undefined, orderId },
    });
  }

  private reject(reason: DiscountRejectionReason): EvaluateResult {
    return { valid: false, reason, message: DISCOUNT_REJECTION_MESSAGES[reason] };
  }

  // Public — reused by DraftOrdersService to preview the discount amount on
  // an as-yet-unconverted draft order without duplicating the type/value math.
  computeAmount(discount: { type: string; value: Prisma.Decimal | null }, cartSubtotal: number): number {
    if (discount.type === 'FREE_SHIPPING') return 0;
    const value = Number(discount.value ?? 0);
    if (discount.type === 'PERCENTAGE') {
      return Math.min(cartSubtotal, (cartSubtotal * value) / 100);
    }
    return Math.min(cartSubtotal, value);
  }

  private normalizeCode(code: string): string {
    return code.trim().toUpperCase();
  }

  private assertFieldsMatchType(dto: { type: DiscountType; value?: number }) {
    if (dto.type === 'FREE_SHIPPING') {
      if (dto.value !== undefined) {
        throw new BadRequestException('value must not be set for a FREE_SHIPPING discount');
      }
    } else if (dto.value === undefined) {
      throw new BadRequestException(`value is required for a ${dto.type} discount`);
    }
  }

  private async assertEligibilityTargetsBelongToShop(
    ctx: TenantContext,
    dto: { appliesTo?: string; productIds?: number[]; categoryIds?: number[] },
  ) {
    if (dto.productIds?.length) {
      const count = await this.prisma.product.count({
        where: { id: { in: dto.productIds }, shopId: ctx.shopId },
      });
      if (count !== new Set(dto.productIds).size) {
        throw new BadRequestException('One or more productIds are invalid for this shop');
      }
    }
    if (dto.categoryIds?.length) {
      const count = await this.prisma.category.count({
        where: { id: { in: dto.categoryIds }, shopId: ctx.shopId },
      });
      if (count !== new Set(dto.categoryIds).size) {
        throw new BadRequestException('One or more categoryIds are invalid for this shop');
      }
    }
  }

  private async findRaw(ctx: TenantContext, id: number) {
    const discount = await this.prisma.discount.findFirst({ where: { id, shopId: ctx.shopId } });
    if (!discount) {
      throw new NotFoundException(`Discount ${id} not found`);
    }
    return discount;
  }

  private toResponse(discount: DiscountWithEligibility) {
    const { discountproduct, discountcategory, ...rest } = discount;
    return {
      ...rest,
      products: discountproduct.map((dp) => dp.product),
      categories: discountcategory.map((dc) => dc.category),
    };
  }

  private handlePrismaError(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ConflictException('A discount with this code already exists');
    }
    throw error;
  }
}
