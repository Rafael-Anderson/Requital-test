import {
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
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { PlatformAdminService } from './platform-admin.service';
import { PlatformAuditLogService } from './platform-audit-log.service';
import { WebhookLogService } from '../webhook-log/webhook-log.service';
import { SliderSettingsService } from '../delivery-providers/slider-settings.service';
import { SetSliderAccountIdDto } from '../delivery-providers/dto/set-slider-account-id.dto';
import { ListShopsQueryDto } from './dto/list-shops-query.dto';
import { SetFeatureOverrideDto } from './dto/set-feature-override.dto';
import { ListWebhookLogQueryDto } from './dto/list-webhook-log-query.dto';
import { CurrencyRatesService } from '../currency-rates/currency-rates.service';
import { SetCurrencyRateDto } from '../currency-rates/dto/set-currency-rate.dto';
import { PlatformAdminGuard } from '../platform-auth/guards/platform-admin.guard';
import { CurrentPlatformAdmin } from '../platform-auth/decorators/current-platform-admin.decorator';
import type { PlatformAdminContext } from '../platform-auth/guards/platform-admin.guard';
import { Public } from '../auth/decorators/public.decorator';
import {
  STAFF_ACCESS_COOKIE,
  STAFF_REFRESH_COOKIE,
  STAFF_REFRESH_PATH,
  staffCsrf,
} from '../auth/auth.constants';
import { sessionCookieOptions } from '../common/cookies';

// See AuthController's own isTest comment — same reasoning, applied here so
// platform-admin.e2e-spec.ts's existing impersonation test (which reads
// session.accessToken to call /auth/me with a bearer header, exercising
// AuthGuard's own NODE_ENV=test fallback) keeps working unchanged.
const isTest = process.env.NODE_ENV === 'test';

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
    private readonly currencyRatesService: CurrencyRatesService,
  ) {}

  @Get('shops')
  listShops(@Query() query: ListShopsQueryDto) {
    return this.platformAdminService.listShops(query);
  }

  // The gate for deleting the legacy name-based delivery-zone matcher: shops still
  // waiting on a merchant to confirm their zones' regions. Zero rows means the
  // legacy branch (zone-matching-mode.ts) can go.
  @Get('zone-mapping-status')
  zoneMappingStatus() {
    return this.platformAdminService.listLegacyZoneMappingShops();
  }

  @Get('shops/:shopId')
  getShop(@Param('shopId', ParseIntPipe) shopId: number) {
    return this.platformAdminService.getShopDetail(shopId);
  }

  @Get('shops/:shopId/features')
  listFeatures(@Param('shopId', ParseIntPipe) shopId: number) {
    return this.platformAdminService.listFeatures(shopId);
  }

  @Put('shops/:shopId/features/:key')
  setFeature(
    @CurrentPlatformAdmin() admin: PlatformAdminContext,
    @Param('shopId', ParseIntPipe) shopId: number,
    @Param('key') key: string,
    @Body() dto: SetFeatureOverrideDto,
  ) {
    return this.platformAdminService.setFeatureOverride(
      admin.id,
      shopId,
      key,
      dto.enabled,
      dto.note ?? null,
    );
  }

  @Delete('shops/:shopId/features/:key')
  clearFeature(
    @CurrentPlatformAdmin() admin: PlatformAdminContext,
    @Param('shopId', ParseIntPipe) shopId: number,
    @Param('key') key: string,
  ) {
    return this.platformAdminService.clearFeatureOverride(
      admin.id,
      shopId,
      key,
    );
  }

  @Get('shops/:shopId/users')
  listShopUsers(@Param('shopId', ParseIntPipe) shopId: number) {
    return this.platformAdminService.listShopUsers(shopId);
  }

  // The only recovery for a sole shop admin who lost their device and recovery
  // codes. Response is { success: true } and nothing else.
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('shops/:shopId/users/:userId/reset-2fa')
  resetUserTwoFactor(
    @CurrentPlatformAdmin() admin: PlatformAdminContext,
    @Param('shopId', ParseIntPipe) shopId: number,
    @Param('userId', ParseIntPipe) userId: number,
  ) {
    return this.platformAdminService.resetShopUserTwoFactor(
      admin.id,
      shopId,
      userId,
    );
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

  // Session-cookie migration (security audit finding #1), phase 2 —
  // impersonation now sets the staff cookies directly on this response
  // instead of returning tokens in the JSON body: this request is
  // same-origin (api's own host) regardless of which frontend page
  // triggered it, so the browser stores the Set-Cookie headers exactly as
  // it would for a real staff login, with no separate token-handoff step
  // needed. The refresh cookie is explicitly CLEARED, not just omitted — a
  // platform admin who also happens to have their own separate merchant
  // login in this browser must not have this impersonation access token
  // silently paired with their own real refresh token on the next
  // silent-refresh (see AuthService.issueImpersonationTokenForShop's own
  // comment: no refreshtoken row is ever created for this token, by
  // design — it must expire on its own like a real login never would).
  @Post('shops/:shopId/impersonate')
  async impersonate(
    @CurrentPlatformAdmin() admin: PlatformAdminContext,
    @Param('shopId', ParseIntPipe) shopId: number,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.platformAdminService.impersonate(
      admin.id,
      shopId,
    );
    res.cookie(
      STAFF_ACCESS_COOKIE,
      session.accessToken,
      sessionCookieOptions('/'),
    );
    res.clearCookie(
      STAFF_REFRESH_COOKIE,
      sessionCookieOptions(STAFF_REFRESH_PATH),
    );
    staffCsrf.issue(req, res, session.accessToken);
    return isTest
      ? session
      : { success: true, accessTokenExpiresIn: session.accessTokenExpiresIn };
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

  // Exchange rates are platform-level, not per-shop — a merchant setting their
  // own conversion could mis-state their own revenue and would make cross-tenant
  // reporting incomparable. See the 20260926220000_currency_rates migration.
  @Get('currency-rates')
  listCurrencyRates() {
    return this.currencyRatesService.list();
  }

  @Patch('currency-rates')
  async setCurrencyRate(
    @CurrentPlatformAdmin() admin: PlatformAdminContext,
    @Body() dto: SetCurrencyRateDto,
  ) {
    const result = await this.currencyRatesService.setRate(
      dto.quoteCurrency,
      dto.rate,
      admin.id,
    );
    // shopId is null: this is a platform-wide change, not one shop's. Awaited
    // before returning, per PlatformAuditLogService's fail-closed contract.
    await this.platformAuditLogService.log(admin.id, 'currency_rate.set', null, {
      quoteCurrency: result.quoteCurrency,
      rate: result.rate,
    });
    return result;
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
