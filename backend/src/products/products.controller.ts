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
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { UpdateProductAvailabilityDto } from './dto/update-product-availability.dto';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { TransferStockDto } from './dto/transfer-stock.dto';
import { AdjustStockWithReasonDto } from './dto/adjust-stock-with-reason.dto';
import { SetLowStockThresholdDto } from './dto/set-low-stock-threshold.dto';
import { ListStockMovementsQueryDto } from './dto/list-stock-movements-query.dto';
import { BulkProductIdsDto } from './dto/bulk-product-ids.dto';
import { BulkUpdateProductStatusDto } from './dto/bulk-update-product-status.dto';
import { BulkPriceUpdateDto } from './dto/bulk-price-update.dto';
import { ListProductsQueryDto } from './dto/list-products-query.dto';
import { UpdateProductOptionsDto } from './dto/update-product-options.dto';
import { UpdateVariantDto } from './dto/update-variant.dto';
import { createImageUploadOptions } from '../common/image-upload.config';
import { csvUploadOptions } from '../common/csv-upload.config';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';

// Reads, per-outlet stock adjustment, and the availability toggle stay open
// to any authenticated role — a branch user managing their own outlet's
// day-to-day stock/availability reality is normal. Everything that edits
// the shared catalog *structure* (name, price, images, category
// assignment, create/delete) is admin-only, same as Outlets/DeliveryZones.
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  findAll(
    @CurrentUser() ctx: TenantContext,
    @Query() query: ListProductsQueryDto,
  ) {
    return this.productsService.findAll(ctx, query.outletId);
  }

  @Roles('admin')
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', createImageUploadOptions('products')),
  )
  uploadImage(@UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    return { url: `/uploads/products/${file.filename}` };
  }

  // 'viewer' explicitly excluded — this had no role guard at all before,
  // meaning a read-only account could otherwise mutate stock. Not opened to
  // 'order_manager' either: stock/availability sit outside the orders
  // domain that role is scoped to.
  @Roles('admin', 'branch')
  @Patch('stock/bulk-adjust')
  adjustStock(@CurrentUser() ctx: TenantContext, @Body() dto: AdjustStockDto) {
    return this.productsService.adjustStock(ctx, dto);
  }

  // Structural (moves stock between branches) — admin-only, same tier as
  // Outlets CRUD, not opened to 'branch' (a branch account only ever acts
  // within its own outlet elsewhere in this app).
  @Roles('admin')
  @Post('stock/transfer')
  transferStock(@CurrentUser() ctx: TenantContext, @Body() dto: TransferStockDto) {
    return this.productsService.transferStock(ctx, dto);
  }

  // Read-only — parses and validates the uploaded CSV but writes nothing.
  // Registered ahead of :id routes for the same reason as bulk-status/
  // bulk-delete below (a literal 'import' segment could otherwise be
  // captured by a :id param route matching the same method/segment count).
  @Roles('admin')
  @Post('import/preview')
  @UseInterceptors(FileInterceptor('file', csvUploadOptions))
  previewImport(@CurrentUser() ctx: TenantContext, @UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    return this.productsService.previewImportProducts(ctx, file);
  }

  // The client re-submits the same file rather than a preview id — see
  // ProductsService.confirmImportProducts for why this pair is stateless.
  @Roles('admin')
  @Post('import/confirm')
  @UseInterceptors(FileInterceptor('file', csvUploadOptions))
  confirmImport(
    @CurrentUser() ctx: TenantContext,
    @Query() query: ListProductsQueryDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    return this.productsService.confirmImportProducts(ctx, file, query.outletId);
  }

  // Same access tier as bulk-adjust above — this is its reason-coded
  // replacement, not a separate stricter surface.
  @Roles('admin', 'branch')
  @Post('stock/adjust')
  adjustStockWithReason(@CurrentUser() ctx: TenantContext, @Body() dto: AdjustStockWithReasonDto) {
    return this.productsService.adjustStockWithReason(ctx, dto);
  }

  @Roles('admin', 'branch')
  @Get('stock/movements')
  listStockMovements(@CurrentUser() ctx: TenantContext, @Query() query: ListStockMovementsQueryDto) {
    return this.productsService.listStockMovements(ctx, query);
  }

  // Same access tier as the other stock endpoints — a branch user setting
  // their own outlet's reorder point is normal day-to-day inventory
  // management, not a catalog-structure edit.
  @Roles('admin', 'branch')
  @Patch('stock/threshold')
  setLowStockThreshold(@CurrentUser() ctx: TenantContext, @Body() dto: SetLowStockThresholdDto) {
    return this.productsService.setLowStockThreshold(ctx, dto);
  }

  @Get(':id')
  findOne(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: ListProductsQueryDto,
  ) {
    return this.productsService.findOne(ctx, id, query.outletId, query.allOutlets);
  }

  @Roles('admin')
  @Post()
  create(@CurrentUser() ctx: TenantContext, @Body() dto: CreateProductDto) {
    return this.productsService.create(ctx, dto);
  }

  @Roles('admin')
  @Post(':id/duplicate')
  duplicate(@CurrentUser() ctx: TenantContext, @Param('id', ParseIntPipe) id: number) {
    return this.productsService.duplicate(ctx, id);
  }

  // Registered ahead of PATCH :id — a literal "bulk-status" segment would
  // otherwise match the :id param route first (same HTTP method, same
  // segment count) and 400 out of ParseIntPipe before ever reaching this
  // handler. Same reasoning applies to DELETE bulk-delete below.
  @Roles('admin')
  @Patch('bulk-status')
  bulkUpdateStatus(@CurrentUser() ctx: TenantContext, @Body() dto: BulkUpdateProductStatusDto) {
    return this.productsService.bulkUpdateStatus(ctx, dto);
  }

  @Roles('admin')
  @Delete('bulk-delete')
  bulkRemove(@CurrentUser() ctx: TenantContext, @Body() dto: BulkProductIdsDto) {
    return this.productsService.bulkRemove(ctx, dto);
  }

  @Roles('admin')
  @Patch('bulk-price')
  bulkUpdatePrice(@CurrentUser() ctx: TenantContext, @Body() dto: BulkPriceUpdateDto) {
    return this.productsService.bulkUpdatePrice(ctx, dto);
  }

  @Roles('admin')
  @Patch(':id')
  update(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProductDto,
  ) {
    return this.productsService.update(ctx, id, dto);
  }

  // Full replace of the option/value set — see ProductsService.updateOptions
  // for the reconciliation rules that keep already-edited variants intact.
  @Roles('admin')
  @Put(':id/options')
  updateOptions(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProductOptionsDto,
  ) {
    return this.productsService.updateOptions(ctx, id, dto);
  }

  @Roles('admin')
  @Patch(':id/variants/:variantId')
  updateVariant(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Param('variantId', ParseIntPipe) variantId: number,
    @Body() dto: UpdateVariantDto,
  ) {
    return this.productsService.updateVariant(ctx, id, variantId, dto);
  }

  // Deliberately its own route + DTO (status only) rather than folded into
  // PATCH /:id — that endpoint is admin-only and this one isn't, so they
  // can't share a body a branch user could pad with a name/price change.
  // 'viewer' excluded same as adjustStock above (previously unguarded).
  @Roles('admin', 'branch')
  @Patch(':id/availability')
  updateAvailability(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProductAvailabilityDto,
  ) {
    return this.productsService.updateAvailability(ctx, id, dto);
  }

  @Roles('admin')
  @Delete(':id')
  remove(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.productsService.remove(ctx, id);
  }
}
