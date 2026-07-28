import { BadRequestException, Body, Controller, Get, Patch, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ScanService } from './scan.service';
import { ScanSettingsService } from './scan-settings.service';
import { UpdateScanSettingsDto } from './dto/update-scan-settings.dto';
import { CommitScanDto } from './dto/commit-scan.dto';
import { createImageUploadOptions } from '../common/image-upload.config';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';

// Admin-only across the board — the matched-item path is a stock
// adjustment (same tier as adjustStockWithReason, which does allow
// 'branch'), but the unmatched path can create catalog structure
// (Products/Ingredients), which is admin-only everywhere else in this app
// (see ProductsController). Splitting the two paths by role within one
// review batch isn't worth the complexity this feature already carries, so
// the whole thing is admin-only.
@Roles('admin')
@Controller('scan')
export class ScanController {
  constructor(
    private readonly scanService: ScanService,
    private readonly scanSettingsService: ScanSettingsService,
  ) {}

  @Get('settings')
  getSettings(@CurrentUser() ctx: TenantContext) {
    return this.scanSettingsService.findOne(ctx);
  }

  @Patch('settings')
  updateSettings(@CurrentUser() ctx: TenantContext, @Body() dto: UpdateScanSettingsDto) {
    return this.scanSettingsService.upsert(ctx, dto);
  }

  // Reuses the image-upload pipeline (disk storage under uploads/scans/,
  // same mimetype/size guard as products/categories/seo) — the file is kept
  // either way since POST /scan/commit needs its URL for the scanbatch
  // audit row if the merchant confirms.
  @Post('preview')
  @UseInterceptors(FileInterceptor('file', createImageUploadOptions('scans')))
  preview(@CurrentUser() ctx: TenantContext, @UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    return this.scanService.preview(ctx, file);
  }

  @Post('commit')
  commit(@CurrentUser() ctx: TenantContext, @Body() dto: CommitScanDto) {
    return this.scanService.commit(ctx, dto);
  }
}
