import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';
import { CustomerSegmentsService } from './customer-segments.service';
import { PreviewSegmentDto, SaveSegmentDto } from './dto/segment.dto';

// Same role split as the rest of the customer CRM: customers are shop-wide, so
// branch and order_manager have no access; viewers read, admins write.
// Members are listed through GET /customers?segmentId= (the customer list).
@Controller('customer-segments')
export class CustomerSegmentsController {
  constructor(private readonly segments: CustomerSegmentsService) {}

  @Roles('admin', 'viewer')
  @Get()
  list(@CurrentUser() ctx: TenantContext) {
    return this.segments.list(ctx);
  }

  // Declared before ':id' so the literal path wins.
  @Roles('admin')
  @Post('preview')
  preview(@CurrentUser() ctx: TenantContext, @Body() dto: PreviewSegmentDto) {
    return this.segments.preview(ctx, dto);
  }

  @Roles('admin', 'viewer')
  @Get(':id')
  get(@CurrentUser() ctx: TenantContext, @Param('id', ParseIntPipe) id: number) {
    return this.segments.get(ctx, id);
  }

  @Roles('admin')
  @Post()
  create(@CurrentUser() ctx: TenantContext, @Body() dto: SaveSegmentDto) {
    return this.segments.create(ctx, dto);
  }

  @Roles('admin')
  @Put(':id')
  update(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SaveSegmentDto,
  ) {
    return this.segments.update(ctx, id, dto);
  }

  @Roles('admin')
  @Delete(':id')
  remove(@CurrentUser() ctx: TenantContext, @Param('id', ParseIntPipe) id: number) {
    return this.segments.remove(ctx, id);
  }
}
