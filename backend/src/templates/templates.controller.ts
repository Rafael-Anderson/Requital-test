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
import { TemplatesService } from './templates.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import { SetTemplateProductsDto } from './dto/set-template-products.dto';
import { SetTemplateCollectionsDto } from './dto/set-template-collections.dto';
import { createImageUploadOptions } from '../common/image-upload.config';
import { StorageService } from '../storage/storage.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';

// Admin-only end to end — same tier as Collections (catalog structure, not a
// day-to-day operational surface).
@Roles('admin')
@Controller('templates')
export class TemplatesController {
  constructor(
    private readonly templatesService: TemplatesService,
    private readonly storageService: StorageService,
  ) {}

  @Get()
  findAll(@CurrentUser() ctx: TenantContext) {
    return this.templatesService.findAll(ctx);
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', createImageUploadOptions()))
  uploadImage(
    @CurrentUser() ctx: TenantContext,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    return this.storageService.uploadImage(ctx.shopId, 'templates', file);
  }

  @Get(':id')
  findOne(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.templatesService.findOne(ctx, id);
  }

  @Post()
  create(@CurrentUser() ctx: TenantContext, @Body() dto: CreateTemplateDto) {
    return this.templatesService.create(ctx, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTemplateDto,
  ) {
    return this.templatesService.update(ctx, id, dto);
  }

  @Delete(':id')
  remove(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.templatesService.remove(ctx, id);
  }

  @Put(':id/products')
  setProducts(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetTemplateProductsDto,
  ) {
    return this.templatesService.setProducts(ctx, id, dto);
  }

  @Put(':id/collections')
  setCollections(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetTemplateCollectionsDto,
  ) {
    return this.templatesService.setCollections(ctx, id, dto);
  }
}
