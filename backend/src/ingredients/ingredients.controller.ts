import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  ParseIntPipe,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsPositive } from 'class-validator';
import { IngredientsService } from './ingredients.service';
import { CreateIngredientDto } from './dto/create-ingredient.dto';
import { UpdateIngredientDto } from './dto/update-ingredient.dto';
import { csvUploadOptions } from '../common/csv-upload.config';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';

class ListIngredientsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  outletId?: number;
}

// Reads open to any authenticated role (a branch user checking ingredient
// stock is normal, same as browsing the product catalog); writes to the
// ingredient *entity itself* (name/unit) are admin-only, same tier as
// Categories — there's no branch-level equivalent of "define a new
// ingredient" the way there is for day-to-day stock adjustment (that stays
// on the existing /products/stock/* endpoints, extended for ingredientId).
@Controller('shop/ingredients')
export class IngredientsController {
  constructor(private readonly ingredientsService: IngredientsService) {}

  @Get()
  findAll(@CurrentUser() ctx: TenantContext, @Query() query: ListIngredientsQueryDto) {
    return this.ingredientsService.findAll(ctx, query.outletId);
  }

  @Get(':id')
  findOne(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: ListIngredientsQueryDto,
  ) {
    return this.ingredientsService.findOne(ctx, id, query.outletId);
  }

  @Roles('admin')
  @Post()
  create(@CurrentUser() ctx: TenantContext, @Body() dto: CreateIngredientDto) {
    return this.ingredientsService.create(ctx, dto);
  }

  @Roles('admin')
  @Post('import/preview')
  @UseInterceptors(FileInterceptor('file', csvUploadOptions))
  previewImport(@CurrentUser() ctx: TenantContext, @UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    return this.ingredientsService.previewImportIngredients(ctx, file);
  }

  @Roles('admin')
  @Post('import/confirm')
  @UseInterceptors(FileInterceptor('file', csvUploadOptions))
  confirmImport(
    @CurrentUser() ctx: TenantContext,
    @Query() query: ListIngredientsQueryDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    return this.ingredientsService.confirmImportIngredients(ctx, file, query.outletId);
  }

  @Roles('admin')
  @Patch(':id')
  update(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateIngredientDto,
  ) {
    return this.ingredientsService.update(ctx, id, dto);
  }

  @Roles('admin')
  @Delete(':id')
  remove(@CurrentUser() ctx: TenantContext, @Param('id', ParseIntPipe) id: number) {
    return this.ingredientsService.remove(ctx, id);
  }
}
