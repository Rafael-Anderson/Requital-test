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
import { ShopService } from './shop.service';
import { UpdateShopDto } from './dto/update-shop.dto';
import { UpdateShopDomainDto } from './dto/update-shop-domain.dto';
import { createImageUploadOptions } from '../common/image-upload.config';
import { StorageService } from '../storage/storage.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';

// Every route here is admin-only — branch users have no reason to read or
// write shop-wide business settings, and this is enforced here (not just by
// hiding the Settings tile client-side).
@Roles('admin')
@Controller('shop')
export class ShopController {
  constructor(
    private readonly shopService: ShopService,
    private readonly storageService: StorageService,
  ) {}

  @Get()
  findOne(@CurrentUser() ctx: TenantContext) {
    return this.shopService.findOne(ctx);
  }

  // Backs the admin Publish toggle's disabled/tooltip state — checked
  // before the merchant even tries to publish, using the exact same logic
  // update() enforces server-side (see ShopService.getPublishReadiness).
  @Get('publish-readiness')
  getPublishReadiness(@CurrentUser() ctx: TenantContext) {
    return this.shopService.getPublishReadiness(ctx);
  }

  @Patch()
  update(@CurrentUser() ctx: TenantContext, @Body() dto: UpdateShopDto) {
    return this.shopService.update(ctx, dto);
  }

  @Get('domain')
  getDomain(@CurrentUser() ctx: TenantContext) {
    return this.shopService.getDomainConfig(ctx);
  }

  @Patch('domain')
  updateDomain(
    @CurrentUser() ctx: TenantContext,
    @Body() dto: UpdateShopDomainDto,
  ) {
    return this.shopService.updateDomain(ctx, dto);
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', createImageUploadOptions()))
  uploadLogo(
    @CurrentUser() ctx: TenantContext,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    return this.storageService.uploadImage(ctx.shopId, 'shop', file);
  }
}
