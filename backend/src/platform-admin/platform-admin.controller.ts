import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { PlatformAdminService } from './platform-admin.service';
import { PlatformAuditLogService } from './platform-audit-log.service';
import { WebhookLogService } from '../webhook-log/webhook-log.service';
import { SliderSettingsService } from '../delivery-providers/slider-settings.service';
import { SetSliderAccountIdDto } from '../delivery-providers/dto/set-slider-account-id.dto';
import { ListShopsQueryDto } from './dto/list-shops-query.dto';
import { ListWebhookLogQueryDto } from './dto/list-webhook-log-query.dto';
import { PlatformAdminGuard } from '../platform-auth/guards/platform-admin.guard';
import { CurrentPlatformAdmin } from '../platform-auth/decorators/current-platform-admin.decorator';
import type { PlatformAdminContext } from '../platform-auth/guards/platform-admin.guard';
import { Public } from '../auth/decorators/public.decorator';

// @Public() opts out of the global merchant AuthGuard (an APP_GUARD that
// otherwise runs in front of every controller — see PlatformAuthController's
// matching comment); @UseGuards(PlatformAdminGuard) is the real protection,
// own JWT scope, own 404-on-unauthenticated behavior (see that guard's own
// comment). This replaces the old X-Platform-Admin-Token shared-secret
// surface entirely.
@Public()
@UseGuards(PlatformAdminGuard)
@Controller('platform-admin')
export class PlatformAdminController {
  constructor(
    private readonly platformAdminService: PlatformAdminService,
    private readonly platformAuditLogService: PlatformAuditLogService,
    private readonly webhookLogService: WebhookLogService,
    private readonly sliderSettingsService: SliderSettingsService,
  ) {}

  @Get('shops')
  listShops(@Query() query: ListShopsQueryDto) {
    return this.platformAdminService.listShops(query);
  }

  @Get('shops/:shopId')
  getShop(@Param('shopId', ParseIntPipe) shopId: number) {
    return this.platformAdminService.getShopDetail(shopId);
  }

  @Post('shops/:shopId/suspend')
  suspend(
    @CurrentPlatformAdmin() admin: PlatformAdminContext,
    @Param('shopId', ParseIntPipe) shopId: number,
  ) {
    return this.platformAdminService.suspend(admin.id, shopId);
  }

  @Post('shops/:shopId/unsuspend')
  unsuspend(
    @CurrentPlatformAdmin() admin: PlatformAdminContext,
    @Param('shopId', ParseIntPipe) shopId: number,
  ) {
    return this.platformAdminService.unsuspend(admin.id, shopId);
  }

  @Post('shops/:shopId/impersonate')
  impersonate(
    @CurrentPlatformAdmin() admin: PlatformAdminContext,
    @Param('shopId', ParseIntPipe) shopId: number,
  ) {
    return this.platformAdminService.impersonate(admin.id, shopId);
  }

  // A merchant has no access to Slider's own dashboard to get this value
  // themselves — see SliderSettingsService's own comment.
  @Patch('shops/:shopId/slider-account-id')
  setSliderAccountId(
    @CurrentPlatformAdmin() admin: PlatformAdminContext,
    @Param('shopId', ParseIntPipe) shopId: number,
    @Body() dto: SetSliderAccountIdDto,
  ) {
    return this.sliderSettingsService
      .setAccountId(shopId, dto.accountId)
      .then(async (result) => {
        await this.platformAuditLogService.log(
          admin.id,
          'shop.slider_account_id.set',
          shopId,
        );
        return result;
      });
  }

  @Post('shops/:shopId/slider-test-dispatch')
  async sliderTestDispatch(
    @CurrentPlatformAdmin() admin: PlatformAdminContext,
    @Param('shopId', ParseIntPipe) shopId: number,
  ) {
    const result = await this.platformAdminService.sliderTestDispatch(shopId);
    await this.platformAuditLogService.log(
      admin.id,
      'shop.slider_test_dispatch',
      shopId,
    );
    return result;
  }

  @Get('settings')
  getSettings(@Req() req: Request) {
    const origin = `${req.protocol}://${req.get('host')}`;
    return {
      envVars: this.platformAdminService.getSettingsStatus(),
      webhookUrls: {
        slider: `${origin}/slider/webhook`,
        stripe: `${origin}/payments/webhook/stripe`,
        tabby: `${origin}/payments/webhook/tabby`,
        tamara: `${origin}/payments/webhook/tamara`,
        paypal: `${origin}/payments/webhook/paypal`,
      },
    };
  }

  @Get('webhook-log')
  listWebhookLog(@Query() query: ListWebhookLogQueryDto) {
    return this.webhookLogService.listAll(query);
  }

  @Get('audit-log')
  listAuditLog(@Query('shopId') shopId?: string) {
    return this.platformAuditLogService.list({
      shopId: shopId ? Number(shopId) : undefined,
      limit: 100,
    });
  }
}
