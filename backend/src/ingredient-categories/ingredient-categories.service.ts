import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../common/tenant-context';
import { CreateIngredientCategoryDto } from './dto/create-ingredient-category.dto';
import { UpdateIngredientCategoryDto } from './dto/update-ingredient-category.dto';
import { AuditLogService } from '../audit-log/audit-log.service';

// Deliberately much lighter than CategoriesService — flat, no parent/tree,
// no slug/image/isFeatured (see ingredientcategory's schema comment for
// why: no storefront navigation use case exists for it the way there is
// for product categories).
@Injectable()
export class IngredientCategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  findAll(ctx: TenantContext) {
    return this.prisma.ingredientcategory.findMany({
      where: { shopId: ctx.shopId },
      orderBy: { name: 'asc' },
    });
  }

  async create(ctx: TenantContext, dto: CreateIngredientCategoryDto) {
    return this.prisma.ingredientcategory.create({
      data: { shopId: ctx.shopId, name: dto.name },
    });
  }

  async update(
    ctx: TenantContext,
    id: number,
    dto: UpdateIngredientCategoryDto,
  ) {
    await this.findOne(ctx, id);
    return this.prisma.ingredientcategory.update({
      where: { id },
      data: { name: dto.name },
    });
  }

  async remove(ctx: TenantContext, id: number) {
    const category = await this.findOne(ctx, id);

    const ingredientCount = await this.prisma.ingredient.count({
      where: { categoryId: id },
    });
    if (ingredientCount > 0) {
      throw new ConflictException(
        `Cannot delete: this category has ${ingredientCount} ingredient${ingredientCount === 1 ? '' : 's'} assigned. Reassign or remove them first.`,
      );
    }

    await this.prisma.ingredientcategory.delete({ where: { id } });
    await this.auditLogService.logCtx(ctx, {
      action: 'ingredient_category.deleted',
      entityType: 'ingredientcategory',
      entityId: id,
      before: { name: category.name },
    });
    return { id, deleted: true };
  }

  private async findOne(ctx: TenantContext, id: number) {
    const category = await this.prisma.ingredientcategory.findFirst({
      where: { id, shopId: ctx.shopId },
    });
    if (!category) {
      throw new NotFoundException(`Ingredient category ${id} not found`);
    }
    return category;
  }
}
