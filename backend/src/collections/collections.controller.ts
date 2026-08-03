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
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CollectionsService } from './collections.service';
import { CreateCollectionDto } from './dto/create-collection.dto';
import { UpdateCollectionDto } from './dto/update-collection.dto';
import { SetCollectionProductsDto } from './dto/set-collection-products.dto';
import { createImageUploadOptions } from '../common/image-upload.config';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';

// Admin-only end to end — same tier as Categories (catalog structure, not a
// day-to-day operational surface).
@Roles('admin')
@Controller('collections')
export class CollectionsController {
  constructor(private readonly collectionsService: CollectionsService) {}

  @Get()
  findAll(@CurrentUser() ctx: TenantContext) {
    return this.collectionsService.findAll(ctx);
  }

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', createImageUploadOptions('collections')),
  )
  uploadImage(@UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    return { url: `/uploads/collections/${file.filename}` };
  }

  @Get(':id')
  findOne(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.collectionsService.findOne(ctx, id);
  }

  @Post()
  create(@CurrentUser() ctx: TenantContext, @Body() dto: CreateCollectionDto) {
    return this.collectionsService.create(ctx, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCollectionDto,
  ) {
    return this.collectionsService.update(ctx, id, dto);
  }

  @Delete(':id')
  remove(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.collectionsService.remove(ctx, id);
  }

  @Put(':id/products')
  setProducts(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetCollectionProductsDto,
  ) {
    return this.collectionsService.setProducts(ctx, id, dto);
  }
}
