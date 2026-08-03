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
import { SeoService } from './seo.service';
import { UpdateSeoDto } from './dto/update-seo.dto';
import { createImageUploadOptions } from '../common/image-upload.config';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';

// Admin-only, same as Theme/Shop — SEO metadata is a business-level
// decision, not a branch-level one.
@Roles('admin')
@Controller('seo')
export class SeoController {
  constructor(private readonly seoService: SeoService) {}

  @Get()
  findOne(@CurrentUser() ctx: TenantContext) {
    return this.seoService.findOne(ctx);
  }

  @Patch()
  update(@CurrentUser() ctx: TenantContext, @Body() dto: UpdateSeoDto) {
    return this.seoService.upsert(ctx, dto);
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', createImageUploadOptions('seo')))
  uploadImage(@UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    return { url: `/uploads/seo/${file.filename}` };
  }
}
