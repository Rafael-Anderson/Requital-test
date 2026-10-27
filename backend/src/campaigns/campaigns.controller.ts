import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequiresVerifiedEmail } from '../auth/decorators/requires-verified-email.decorator';
import { VerifiedEmailGuard } from '../auth/guards/verified-email.guard';
import type { TenantContext } from '../common/tenant-context';
import { CampaignsService } from './campaigns.service';
import { CreateCampaignDto, UpdateCampaignDto } from './dto/campaign.dto';

// Admin only. The shop is always ctx.shopId; an id in the path is only ever looked
// up inside it (another shop's campaign is a 404).
@Roles('admin')
@Controller('campaigns')
export class CampaignsController {
  constructor(private readonly service: CampaignsService) {}

  @Get('status')
  status(@CurrentUser() ctx: TenantContext) {
    return this.service.status(ctx);
  }

  @Get()
  list(@CurrentUser() ctx: TenantContext) {
    return this.service.list(ctx);
  }

  @Post()
  create(@CurrentUser() ctx: TenantContext, @Body() dto: CreateCampaignDto) {
    return this.service.create(ctx, dto);
  }

  @Get(':id')
  get(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.get(ctx, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCampaignDto,
  ) {
    return this.service.update(ctx, id, dto);
  }

  @Get(':id/audience')
  audience(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.audiencePreview(ctx, id);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post(':id/test')
  test(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.sendTest(ctx, id);
  }

  @UseGuards(VerifiedEmailGuard)
  @RequiresVerifiedEmail({ action: 'sending a campaign' })
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':id/send')
  send(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.send(ctx, id);
  }

  @Post(':id/cancel')
  cancel(
    @CurrentUser() ctx: TenantContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.cancel(ctx, id);
  }
}
