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
import { BrandsService } from './brands.service';
import { CreateBrandDto } from './dto/create-brand.dto';
import { UpdateBrandDto } from './dto/update-brand.dto';
import { createImageUploadOptions } from '../common/image-upload.config';
import { StorageService } from '../storage/storage.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';

// Reads stay open to any authenticated role (a branch user browsing the
// shared catalog is normal). Every write is admin-only, same tier as
// Collections/Outlets — there's no branch-level equivalent.
@Controller('brands')
export class BrandsController {
  constructor(
    private readonly brandsService: BrandsService,
    private readonly storageService: StorageService,
  ) {}

  @Get()
  findAll(@CurrentUser() ctx: TenantContext) {
    return this.brandsService.findAll(ctx);
  }

  @Roles('admin')
  @Post('upload')
  @UseInterceptors(FileInterceptor('file', createImageUploadOptions()))
  uploadImage(
    @CurrentUser() ctx: TenantContext,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    return this.storageService.uploadImage(ctx.shopId, 'brands', file);
  }

  @Get(':id')
  findOne(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.brandsService.findOne(ctx, id);
  }

  @Roles('admin')
  @Post()
  create(@CurrentUser() ctx: TenantContext, @Body() dto: CreateBrandDto) {
    return this.brandsService.create(ctx, dto);
  }

  @Roles('admin')
  @Patch(':id')
  update(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateBrandDto,
  ) {
    return this.brandsService.update(ctx, id, dto);
  }

  @Roles('admin')
  @Delete(':id')
  remove(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.brandsService.remove(ctx, id);
  }
}
