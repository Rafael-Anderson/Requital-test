import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { IngredientCategoriesService } from './ingredient-categories.service';
import { CreateIngredientCategoryDto } from './dto/create-ingredient-category.dto';
import { UpdateIngredientCategoryDto } from './dto/update-ingredient-category.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';

// Same read-open/write-admin-only split as CategoriesController and
// IngredientsController — defining categories is a catalog-structure
// change, not a day-to-day branch action.
@Controller('shop/ingredient-categories')
export class IngredientCategoriesController {
  constructor(
    private readonly ingredientCategoriesService: IngredientCategoriesService,
  ) {}

  @Get()
  findAll(@CurrentUser() ctx: TenantContext) {
    return this.ingredientCategoriesService.findAll(ctx);
  }

  @Roles('admin')
  @Post()
  create(
    @CurrentUser() ctx: TenantContext,
    @Body() dto: CreateIngredientCategoryDto,
  ) {
    return this.ingredientCategoriesService.create(ctx, dto);
  }

  @Roles('admin')
  @Patch(':id')
  update(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateIngredientCategoryDto,
  ) {
    return this.ingredientCategoriesService.update(ctx, id, dto);
  }

  @Roles('admin')
  @Delete(':id')
  remove(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.ingredientCategoriesService.remove(ctx, id);
  }
}
