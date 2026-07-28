import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { createImageUploadOptions } from '../common/image-upload.config';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';

// Reads stay open to any authenticated role (a branch user browsing the
// shared catalog is normal). Every write is the category *structure* itself
// (name, slug, image, tree position) — admin-only, same as Outlets/
// DeliveryZones — there's no branch-level equivalent of "adjust stock" for
// categories the way there is for products.
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  findAll(@CurrentUser() ctx: TenantContext) {
    return this.categoriesService.findAll(ctx);
  }

  @Roles('admin')
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', createImageUploadOptions('categories')),
  )
  uploadImage(@UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    return { url: `/uploads/categories/${file.filename}` };
  }

  @Get(':id')
  findOne(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.categoriesService.findOne(ctx, id);
  }

  @Roles('admin')
  @Post()
  create(@CurrentUser() ctx: TenantContext, @Body() dto: CreateCategoryDto) {
    return this.categoriesService.create(ctx, dto);
  }

  @Roles('admin')
  @Patch(':id')
  update(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.categoriesService.update(ctx, id, dto);
  }

  @Roles('admin')
  @Delete(':id')
  remove(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.categoriesService.remove(ctx, id);
  }
}
