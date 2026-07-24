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
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { ListProductsQueryDto } from './dto/list-products-query.dto';
import { createImageUploadOptions } from '../common/image-upload.config';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';

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

  @Patch('stock/bulk-adjust')
  adjustStock(@CurrentUser() ctx: TenantContext, @Body() dto: AdjustStockDto) {
    return this.productsService.adjustStock(ctx, dto);
  }

  @Get(':id')
  findOne(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: ListProductsQueryDto,
  ) {
    return this.productsService.findOne(ctx, id, query.outletId);
  }

  @Post()
  create(@CurrentUser() ctx: TenantContext, @Body() dto: CreateProductDto) {
    return this.productsService.create(ctx, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProductDto,
  ) {
    return this.productsService.update(ctx, id, dto);
  }

  @Delete(':id')
  remove(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.productsService.remove(ctx, id);
  }
}
