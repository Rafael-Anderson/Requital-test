import { Body, Controller, Get, Post, Put, Query } from '@nestjs/common';
import { ReorderService } from './reorder.service';
import {
  CreateDraftPosDto,
  ReorderQueryDto,
  SetReorderPointDto,
} from './dto/reorder.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';

// INV-5. Reading and drafting: admin and branch (the service pins a branch user to
// its outlet and applies the per-outlet permission on top). Setting the point is
// admin-only: it is the merchant's purchasing policy.
@Controller('reorder')
export class ReorderController {
  constructor(private readonly reorder: ReorderService) {}

  @Roles('admin')
  @Put('points')
  setPoint(@CurrentUser() ctx: TenantContext, @Body() dto: SetReorderPointDto) {
    return this.reorder.setPoint(ctx, dto);
  }

  @Roles('admin', 'branch')
  @Get('low-stock')
  lowStock(@CurrentUser() ctx: TenantContext, @Query() q: ReorderQueryDto) {
    return this.reorder.lowStock(ctx, q.outletId);
  }

  @Roles('admin', 'branch')
  @Get('suggestions')
  suggestions(@CurrentUser() ctx: TenantContext, @Query() q: ReorderQueryDto) {
    return this.reorder.suggestions(ctx, q.outletId);
  }

  @Roles('admin', 'branch')
  @Post('suggestions/draft-pos')
  createDrafts(@CurrentUser() ctx: TenantContext, @Body() dto: CreateDraftPosDto) {
    return this.reorder.createDrafts(ctx, dto);
  }
}
