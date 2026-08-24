import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { OutletsService } from './outlets.service';
import { CreateOutletDto } from './dto/create-outlet.dto';
import { UpdateOutletDto } from './dto/update-outlet.dto';
import { UpdateOutletStatusDto } from './dto/update-outlet-status.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';

@Controller('outlets')
export class OutletsController {
  constructor(private readonly outletsService: OutletsService) {}

  @Get()
  findAll(@CurrentUser() ctx: TenantContext) {
    return this.outletsService.findAll(ctx);
  }

  // Registered before ':id' so a literal "geocode" segment never gets
  // swallowed by the param route.
  @Roles('admin')
  @Get('geocode')
  geocode(@Query('q') query?: string) {
    return this.outletsService.geocode(query);
  }

  // Registered before ':id' for the same reason as 'geocode' above.
  @Roles('admin')
  @Get('reverse-geocode')
  reverseGeocode(@Query('lat') lat?: string, @Query('lon') lon?: string) {
    return this.outletsService.reverseGeocode(
      lat !== undefined ? Number(lat) : undefined,
      lon !== undefined ? Number(lon) : undefined,
    );
  }

  @Get(':id')
  findOne(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.outletsService.findOne(ctx, id);
  }

  @Roles('admin')
  @Post()
  create(@CurrentUser() ctx: TenantContext, @Body() dto: CreateOutletDto) {
    return this.outletsService.create(ctx, dto);
  }

  @Roles('admin')
  @Patch(':id')
  update(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateOutletDto,
  ) {
    return this.outletsService.update(ctx, id, dto);
  }

  // Deliberately not admin-only — see UpdateOutletStatusDto's own comment.
  // 'viewer' excluded, matching this codebase's viewer-never-mutates
  // invariant everywhere else (Orders, etc.) even though viewer can see
  // this same data via GET /outlets above.
  @Roles('admin', 'branch', 'order_manager')
  @Patch(':id/status')
  updateStatus(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateOutletStatusDto,
  ) {
    return this.outletsService.updateStatus(ctx, id, dto);
  }

  @Roles('admin')
  @Delete(':id')
  remove(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.outletsService.remove(ctx, id);
  }
}
