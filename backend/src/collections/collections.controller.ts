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
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CollectionsService } from './collections.service';
import { CreateCollectionDto } from './dto/create-collection.dto';
import { UpdateCollectionDto } from './dto/update-collection.dto';
import { ReorderCollectionsDto } from './dto/reorder-collections.dto';
import { createImageUploadOptions } from '../common/image-upload.config';
import { StorageService } from '../storage/storage.service';
import { CollectionImportService } from './collection-import.service';
import { ImportCollectionsQueryDto } from './dto/import-collections-query.dto';
import { tableUploadOptions } from '../common/csv-upload.config';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';

// Reads stay open to any authenticated role (a branch user browsing the
// shared catalog is normal). Every write is the collection *structure* itself
// (name, slug, image, tree position) — admin-only, same as Outlets/
// DeliveryZones — there's no branch-level equivalent of "adjust stock" for
// collections the way there is for products.
@Controller('collections')
export class CollectionsController {
  constructor(
    private readonly collectionsService: CollectionsService,
    private readonly storageService: StorageService,
    private readonly collectionImport: CollectionImportService,
  ) {}

  @Get()
  findAll(@CurrentUser() ctx: TenantContext) {
    return this.collectionsService.findAll(ctx);
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
    return this.storageService.uploadImage(ctx.shopId, 'collections', file);
  }

  // Import (ONB-1). POST, so no clash with the :id routes below; preview writes
  // nothing, confirm re-reads the same file (stateless pair).
  @Roles('admin')
  @Post('import/preview')
  @UseInterceptors(FileInterceptor('file', tableUploadOptions))
  previewImport(
    @CurrentUser() ctx: TenantContext,
    @Query() query: ImportCollectionsQueryDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.collectionImport.preview(ctx, file, query.onExisting);
  }

  @Roles('admin')
  @Post('import/confirm')
  @UseInterceptors(FileInterceptor('file', tableUploadOptions))
  confirmImport(
    @CurrentUser() ctx: TenantContext,
    @Query() query: ImportCollectionsQueryDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.collectionImport.confirm(ctx, file, query.onExisting);
  }

  // Placed before the :id route, same reason bio-links documents: a numeric
  // ParseIntPipe route would otherwise try (and fail) to parse the literal
  // 'reorder' segment as an id.
  @Roles('admin')
  @Patch('reorder')
  reorder(
    @CurrentUser() ctx: TenantContext,
    @Body() dto: ReorderCollectionsDto,
  ) {
    return this.collectionsService.reorder(ctx, dto);
  }

  @Get(':id')
  findOne(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.collectionsService.findOne(ctx, id);
  }

  @Roles('admin')
  @Post()
  create(@CurrentUser() ctx: TenantContext, @Body() dto: CreateCollectionDto) {
    return this.collectionsService.create(ctx, dto);
  }

  @Roles('admin')
  @Patch(':id')
  update(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCollectionDto,
  ) {
    return this.collectionsService.update(ctx, id, dto);
  }

  @Roles('admin')
  @Delete(':id')
  remove(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.collectionsService.remove(ctx, id);
  }
}
