import { Body, Controller, Delete } from '@nestjs/common';
import { StorageService } from './storage.service';
import { DeleteUploadDto } from './dto/delete-upload.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';

// Shared delete surface for every image upload endpoint (products,
// categories, collections, ingredients, theme, bio-links, shop, seo, scan)
// — same "one shared thing, parameterized by call site" shape
// createImageUploadOptions already used for uploads themselves. Same
// admin-only tier every one of those upload endpoints already is (see each
// controller's own @Roles). `key` (the storage key, from a previous
// upload's response) rather than a numeric id — there's no DB row backing
// an upload on its own; ownership is verified by reading the shopId
// embedded in the key itself (see StorageService.deleteImage), which is
// also why a cross-shop key request 404s instead of 403ing — never confirm
// another shop's file exists at all.
@Roles('admin')
@Controller('uploads')
export class UploadsController {
  constructor(private readonly storageService: StorageService) {}

  @Delete()
  async delete(
    @CurrentUser() ctx: TenantContext,
    @Body() dto: DeleteUploadDto,
  ) {
    await this.storageService.deleteImage(ctx.shopId, dto.key);
    return { success: true };
  }
}
