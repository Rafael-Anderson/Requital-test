import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ThemeService } from './theme.service';
import { UpdateThemeDto } from './dto/update-theme.dto';
import { createImageUploadOptions } from '../common/image-upload.config';
import { StorageService } from '../storage/storage.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';

// Admin-only, same as Shop — storefront branding is a business-level
// decision, not a branch-level one.
@Roles('admin')
@Controller('theme')
export class ThemeController {
  constructor(
    private readonly themeService: ThemeService,
    private readonly storageService: StorageService,
  ) {}

  @Get()
  findOne(@CurrentUser() ctx: TenantContext) {
    return this.themeService.findOne(ctx);
  }

  @Patch()
  update(@CurrentUser() ctx: TenantContext, @Body() dto: UpdateThemeDto) {
    return this.themeService.upsert(ctx, dto);
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
    return this.storageService.uploadImage(ctx.shopId, 'theme', file);
  }
}
