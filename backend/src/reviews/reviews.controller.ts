import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';
import { ReviewsService } from './reviews.service';
import { ListReviewsQueryDto } from './dto/list-reviews-query.dto';
import { SetReviewFeaturedDto } from './dto/set-featured.dto';

// Admin-only: choosing what appears on the storefront is a shop-owner call, and
// the list shows customer names against their feedback. Scoped by ctx.shopId.
@Roles('admin')
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly service: ReviewsService) {}

  @Get()
  list(@CurrentUser() ctx: TenantContext, @Query() query: ListReviewsQueryDto) {
    return this.service.list(ctx, query);
  }

  @Patch(':id/featured')
  setFeatured(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetReviewFeaturedDto,
  ) {
    return this.service.setFeatured(ctx, id, dto.featured);
  }
}
