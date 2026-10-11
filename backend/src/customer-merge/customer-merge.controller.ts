import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';
import { CustomerMergeService } from './customer-merge.service';
import { MergeCustomersDto, PreviewMergeDto } from './dto/merge.dto';

// Admin only: a merge rewrites ownership of orders and money and cannot be
// undone. Viewers may read the merge history of a customer.
@Controller('customers/:id')
export class CustomerMergeController {
  constructor(private readonly merges: CustomerMergeService) {}

  @Roles('admin', 'viewer')
  @Get('merges')
  history(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.merges.history(ctx, id);
  }

  @Roles('admin')
  @Post('merge-preview')
  preview(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PreviewMergeDto,
  ) {
    return this.merges.preview(ctx, id, dto.duplicateIds);
  }

  @Roles('admin')
  @Post('merge')
  merge(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: MergeCustomersDto,
  ) {
    return this.merges.merge(ctx, id, dto);
  }
}
