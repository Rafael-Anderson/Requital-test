import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../common/tenant-context';
import { resolveOutletFilter } from '../common/outlet-scope';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { AdjustStockDto } from './dto/adjust-stock.dto';

const productInclude = {
  productcategory: { include: { category: true } },
  producttag: { include: { tag: true } },
} satisfies Prisma.productInclude;

type ProductWithRelations = Prisma.productGetPayload<{
  include: typeof productInclude;
}> & { outletstock?: { stockQuantity: number; lowStockThreshold: number }[] };

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(ctx: TenantContext, requestedOutletId?: number) {
    const outletId = resolveOutletFilter(ctx, requestedOutletId);
    const products = await this.prisma.product.findMany({
      where: { shopId: ctx.shopId },
      include: this.includeFor(outletId),
      orderBy: { id: 'asc' },
    });
    return products.map((product) => this.toResponse(product));
  }

  async findOne(ctx: TenantContext, id: number, requestedOutletId?: number) {
    const outletId = resolveOutletFilter(ctx, requestedOutletId);
    const product = await this.prisma.product.findFirst({
      where: { id, shopId: ctx.shopId },
      include: this.includeFor(outletId),
    });
    if (!product) {
      throw new NotFoundException(`Product ${id} not found`);
    }
    return this.toResponse(product);
  }

  async create(ctx: TenantContext, dto: CreateProductDto) {
    await this.assertCategoriesBelongToShop(ctx, dto.categoryIds);
    const tagIds = dto.tags?.length
      ? await this.resolveTagIds(ctx, dto.tags)
      : [];

    try {
      const product = await this.prisma.product.create({
        data: {
          shopId: ctx.shopId,
          name: dto.name,
          price: dto.price,
          thumbnail: dto.thumbnail,
          sku: dto.sku,
          description: dto.description,
          shortSummary: dto.shortSummary,
          longSummary: dto.longSummary,
          costPrice: dto.costPrice,
          status: dto.status ?? 'Available',
          trackInventory: dto.trackInventory ?? false,
          productcategory: {
            create: dto.categoryIds.map((categoryId) => ({ categoryId })),
          },
          producttag: { create: tagIds.map((tagId) => ({ tagId })) },
        },
        include: productInclude,
      });
      return this.toResponse(product);
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async update(ctx: TenantContext, id: number, dto: UpdateProductDto) {
    await this.findOne(ctx, id);

    if (dto.categoryIds) {
      await this.assertCategoriesBelongToShop(ctx, dto.categoryIds);
    }
    const tagIds =
      dto.tags !== undefined
        ? await this.resolveTagIds(ctx, dto.tags)
        : undefined;

    try {
      const product = await this.prisma.$transaction(async (tx) => {
        if (dto.categoryIds) {
          await tx.productcategory.deleteMany({ where: { productId: id } });
        }
        if (tagIds !== undefined) {
          await tx.producttag.deleteMany({ where: { productId: id } });
        }
        return tx.product.update({
          where: { id },
          data: {
            name: dto.name,
            price: dto.price,
            thumbnail: dto.thumbnail,
            sku: dto.sku,
            description: dto.description,
            shortSummary: dto.shortSummary,
            longSummary: dto.longSummary,
            costPrice: dto.costPrice,
            status: dto.status,
            trackInventory: dto.trackInventory,
            ...(dto.categoryIds && {
              productcategory: {
                create: dto.categoryIds.map((categoryId) => ({
                  categoryId,
                })),
              },
            }),
            ...(tagIds !== undefined && {
              producttag: { create: tagIds.map((tagId) => ({ tagId })) },
            }),
          },
          include: productInclude,
        });
      });
      return this.toResponse(product);
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async adjustStock(ctx: TenantContext, dto: AdjustStockDto) {
    // Same outlet-override rule as order creation: a branch user's request
    // is always forced onto their own outlet, no matter what outletId (if
    // any) they send.
    const outletId = ctx.role === 'branch' ? ctx.outletId! : dto.outletId;
    if (outletId === undefined) {
      throw new BadRequestException('outletId is required');
    }
    const outlet = await this.prisma.outlet.findFirst({
      where: { id: outletId, shopId: ctx.shopId },
    });
    if (!outlet) {
      throw new BadRequestException('outletId is invalid for this shop');
    }

    const productIds = dto.adjustments.map((a) => a.productId);
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, shopId: ctx.shopId },
    });
    if (products.length !== new Set(productIds).size) {
      throw new BadRequestException(
        'One or more productIds are invalid for this shop',
      );
    }

    const currentStock = await this.prisma.outletstock.findMany({
      where: { outletId, productId: { in: productIds } },
    });
    const currentByProduct = new Map(
      currentStock.map((s) => [s.productId, s.stockQuantity]),
    );
    for (const { productId, delta } of dto.adjustments) {
      const current = currentByProduct.get(productId) ?? 0;
      if (current + delta < 0) {
        throw new BadRequestException(
          `Adjustment would take product ${productId} below zero stock at this outlet`,
        );
      }
    }

    await this.prisma.$transaction(
      dto.adjustments.map(({ productId, delta }) =>
        this.prisma.outletstock.upsert({
          where: { outletId_productId: { outletId, productId } },
          update: { stockQuantity: { increment: delta } },
          create: { outletId, productId, stockQuantity: delta },
        }),
      ),
    );
    return this.prisma.outletstock.findMany({
      where: { outletId, productId: { in: productIds } },
      select: { productId: true, stockQuantity: true },
    });
  }

  async remove(ctx: TenantContext, id: number) {
    await this.findOne(ctx, id);
    await this.prisma.product.delete({ where: { id } });
    return { id, deleted: true };
  }

  private includeFor(outletId: number | undefined) {
    return {
      ...productInclude,
      ...(outletId !== undefined && {
        outletstock: {
          where: { outletId },
          select: { stockQuantity: true, lowStockThreshold: true },
        },
      }),
    };
  }

  private async assertCategoriesBelongToShop(
    ctx: TenantContext,
    categoryIds: number[],
  ) {
    const uniqueIds = [...new Set(categoryIds)];
    const count = await this.prisma.category.count({
      where: { id: { in: uniqueIds }, shopId: ctx.shopId },
    });
    if (count !== uniqueIds.length) {
      throw new BadRequestException(
        'One or more categoryIds are invalid for this shop',
      );
    }
  }

  private async resolveTagIds(
    ctx: TenantContext,
    names: string[],
  ): Promise<number[]> {
    const uniqueNames = [
      ...new Set(names.map((name) => name.trim()).filter(Boolean)),
    ];
    const tagIds: number[] = [];
    for (const name of uniqueNames) {
      const tag = await this.prisma.tag.upsert({
        where: { shopId_name: { shopId: ctx.shopId, name } },
        update: {},
        create: { shopId: ctx.shopId, name },
      });
      tagIds.push(tag.id);
    }
    return tagIds;
  }

  private toResponse(product: ProductWithRelations) {
    const { productcategory, producttag, outletstock, ...rest } = product;
    const stock = outletstock?.[0];
    return {
      ...rest,
      categories: productcategory.map((pc) => pc.category),
      tags: producttag.map((pt) => pt.tag.name),
      // null when no outlet was resolved for this request (e.g. an admin
      // viewing the catalog without picking a branch) — distinct from 0,
      // which means "this outlet genuinely has none in stock".
      stockQuantity: stock?.stockQuantity ?? null,
      lowStockThreshold: stock?.lowStockThreshold ?? null,
    };
  }

  private handlePrismaError(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException('A product with this SKU already exists');
    }
    throw error;
  }
}
