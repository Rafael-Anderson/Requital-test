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
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';
import { csvUploadOptions } from '../common/csv-upload.config';
import { UrlRedirectsService } from './url-redirects.service';
import { CreateUrlRedirectDto } from './dto/create-url-redirect.dto';
import { UpdateUrlRedirectDto } from './dto/update-url-redirect.dto';
import { ListUrlRedirectsQueryDto } from './dto/list-url-redirects-query.dto';

// Admin-only, reads included: this is a Settings > Storefront surface and the
// 404 report exposes what visitors request. Every query is scoped by
// ctx.shopId (re-read from the DB by AuthGuard), never by anything in the
// request.
@Roles('admin')
@Controller('url-redirects')
export class UrlRedirectsController {
  constructor(private readonly service: UrlRedirectsService) {}

  @Get()
  list(
    @CurrentUser() ctx: TenantContext,
    @Query() query: ListUrlRedirectsQueryDto,
  ) {
    return this.service.list(ctx, query);
  }

  // Static segments are declared before ':id' so they are never captured by it.
  @Post('import/preview')
  @UseInterceptors(FileInterceptor('file', csvUploadOptions))
  previewImport(
    @CurrentUser() ctx: TenantContext,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.service.previewImport(ctx, file);
  }

  @Post('import/confirm')
  @UseInterceptors(FileInterceptor('file', csvUploadOptions))
  confirmImport(
    @CurrentUser() ctx: TenantContext,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.service.confirmImport(ctx, file);
  }

  @Get('not-found-log')
  listNotFound(
    @CurrentUser() ctx: TenantContext,
    @Query() query: ListUrlRedirectsQueryDto,
  ) {
    return this.service.listNotFound(ctx, query);
  }

  @Delete('not-found-log')
  clearNotFound(@CurrentUser() ctx: TenantContext) {
    return this.service.clearNotFound(ctx);
  }

  @Delete('not-found-log/:id')
  dismissNotFound(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.dismissNotFound(ctx, id);
  }

  @Post()
  create(@CurrentUser() ctx: TenantContext, @Body() dto: CreateUrlRedirectDto) {
    return this.service.create(ctx, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateUrlRedirectDto,
  ) {
    return this.service.update(ctx, id, dto);
  }

  @Delete(':id')
  remove(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.remove(ctx, id);
  }
}
