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
import { BioLinksService } from './bio-links.service';
import { CreateBioLinkDto } from './dto/create-bio-link.dto';
import { UpdateBioLinkDto } from './dto/update-bio-link.dto';
import { ReorderBioLinksDto } from './dto/reorder-bio-links.dto';
import { UpdateBioPageConfigDto } from './dto/update-bio-page-config.dto';
import { createImageUploadOptions } from '../common/image-upload.config';
import { StorageService } from '../storage/storage.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';

// Admin-only, entirely — same access level as Theme/Reports (merchant-facing
// storefront configuration, not something branch staff manage). Scoped to
// ctx.shopId throughout (see BioLinksService) — a shopId is never read from
// the request body.
@Roles('admin')
@Controller('shop/bio-links')
export class BioLinksController {
  constructor(
    private readonly bioLinksService: BioLinksService,
    private readonly storageService: StorageService,
  ) {}

  @Get()
  findAll(@CurrentUser() ctx: TenantContext) {
    return this.bioLinksService.findAll(ctx);
  }

  @Post()
  create(@CurrentUser() ctx: TenantContext, @Body() dto: CreateBioLinkDto) {
    return this.bioLinksService.create(ctx, dto);
  }

  // Registered before ':id' — a literal path segment must win over the
  // numeric-id route, or PATCH .../reorder would be swallowed by
  // ParseIntPipe attempting (and failing) to parse 'reorder' as :id.
  @Patch('reorder')
  reorder(@CurrentUser() ctx: TenantContext, @Body() dto: ReorderBioLinksDto) {
    return this.bioLinksService.reorder(ctx, dto);
  }

  // Page-level config (logo/background/description/meta) for the /bio
  // storefront page — a sibling concern to the link list itself, kept on
  // this same controller rather than a third one. 'page-config' is a
  // literal segment, same reorder-vs-:id ordering concern for the PATCH.
  @Get('page-config')
  getPageConfig(@CurrentUser() ctx: TenantContext) {
    return this.bioLinksService.getPageConfig(ctx);
  }

  @Patch('page-config')
  updatePageConfig(
    @CurrentUser() ctx: TenantContext,
    @Body() dto: UpdateBioPageConfigDto,
  ) {
    return this.bioLinksService.updatePageConfig(ctx, dto);
  }

  // Reuses the existing upload pipeline (see common/image-upload.config.ts)
  // — same pattern as Theme/SEO's own upload endpoints, just a different
  // subdirectory. No new upload machinery.
  @Post('upload')
  @UseInterceptors(FileInterceptor('file', createImageUploadOptions()))
  uploadImage(
    @CurrentUser() ctx: TenantContext,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    return this.storageService.uploadImage(ctx.shopId, 'bio-links', file);
  }

  @Patch(':id')
  update(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateBioLinkDto,
  ) {
    return this.bioLinksService.update(ctx, id, dto);
  }

  @Delete(':id')
  remove(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.bioLinksService.remove(ctx, id);
  }
}
