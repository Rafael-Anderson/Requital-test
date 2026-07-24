import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../common/tenant-context';
import { slugify } from '../common/slugify';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(ctx: TenantContext) {
    return this.prisma.category.findMany({
      where: { shopId: ctx.shopId },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async findOne(ctx: TenantContext, id: number) {
    const category = await this.prisma.category.findFirst({
      where: { id, shopId: ctx.shopId },
    });
    if (!category) {
      throw new NotFoundException(`Category ${id} not found`);
    }
    return category;
  }

  async create(ctx: TenantContext, dto: CreateCategoryDto) {
    if (dto.parentCategoryId !== undefined) {
      await this.assertParentBelongsToShop(ctx, dto.parentCategoryId);
    }

    try {
      return await this.prisma.category.create({
        data: {
          shopId: ctx.shopId,
          name: dto.name,
          slug: dto.slug ?? slugify(dto.name),
          parentCategoryId: dto.parentCategoryId,
          displayOrder: dto.displayOrder ?? 0,
          image: dto.image,
          isFeatured: dto.isFeatured ?? false,
        },
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async update(ctx: TenantContext, id: number, dto: UpdateCategoryDto) {
    await this.findOne(ctx, id);

    if (dto.parentCategoryId !== undefined && dto.parentCategoryId !== null) {
      if (dto.parentCategoryId === id) {
        throw new BadRequestException('A category cannot be its own parent');
      }
      await this.assertParentBelongsToShop(ctx, dto.parentCategoryId);
      await this.assertNoCycle(ctx, id, dto.parentCategoryId);
    }

    try {
      return await this.prisma.category.update({
        where: { id },
        data: {
          name: dto.name,
          slug: dto.slug,
          displayOrder: dto.displayOrder,
          isFeatured: dto.isFeatured,
          ...(dto.parentCategoryId !== undefined && {
            parentCategoryId: dto.parentCategoryId,
          }),
          ...(dto.image !== undefined && { image: dto.image }),
        },
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async remove(ctx: TenantContext, id: number) {
    await this.findOne(ctx, id);

    const [childCount, productCount] = await this.prisma.$transaction([
      this.prisma.category.count({ where: { parentCategoryId: id } }),
      this.prisma.productcategory.count({ where: { categoryId: id } }),
    ]);
    if (childCount > 0 || productCount > 0) {
      throw new ConflictException(
        `Cannot delete: this category has ${childCount} subcategor${childCount === 1 ? 'y' : 'ies'} and ${productCount} product${productCount === 1 ? '' : 's'} assigned. Reassign or remove them first.`,
      );
    }

    await this.prisma.category.delete({ where: { id } });
    return { id, deleted: true };
  }

  private async assertParentBelongsToShop(
    ctx: TenantContext,
    parentCategoryId: number,
  ) {
    const parent = await this.prisma.category.findFirst({
      where: { id: parentCategoryId, shopId: ctx.shopId },
    });
    if (!parent) {
      throw new BadRequestException(
        'parentCategoryId is invalid for this shop',
      );
    }
  }

  // Walks the proposed new parent's ancestor chain — if the category being
  // moved (id) appears anywhere in it, reassigning would create a cycle.
  private async assertNoCycle(
    ctx: TenantContext,
    id: number,
    proposedParentId: number,
  ) {
    let cursor: number | null = proposedParentId;
    const seen = new Set<number>();
    while (cursor !== null) {
      if (cursor === id) {
        throw new BadRequestException(
          'This move would make the category an ancestor of itself',
        );
      }
      if (seen.has(cursor)) break; // defensive: pre-existing cycle, stop walking
      seen.add(cursor);
      const node: { parentCategoryId: number | null } | null =
        await this.prisma.category.findFirst({
          where: { id: cursor, shopId: ctx.shopId },
          select: { parentCategoryId: true },
        });
      cursor = node?.parentCategoryId ?? null;
    }
  }

  private handlePrismaError(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException('A category with this slug already exists');
    }
    throw error;
  }
}
