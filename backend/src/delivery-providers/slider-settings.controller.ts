import { Body, Controller, Get, Patch } from '@nestjs/common';
import { SliderSettingsService } from './slider-settings.service';
import { SetSliderEnabledDto } from './dto/set-slider-enabled.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';

// Merchant-facing, admin-only — same access tier as Payment Gateways/
// WhatsApp settings. A merchant can only toggle Slider on/off for their
// shop; setting the actual Slider account id is platform-admin only (see
// platform-admin/platform-admin.controller.ts) since a merchant has no
// access to Slider's own dashboard to get that value.
@Roles('admin')
@Controller('slider-settings')
export class SliderSettingsController {
  constructor(private readonly sliderSettingsService: SliderSettingsService) {}

  @Get()
  find(@CurrentUser() ctx: TenantContext) {
    return this.sliderSettingsService.find(ctx);
  }

  @Patch()
  setEnabled(
    @CurrentUser() ctx: TenantContext,
    @Body() dto: SetSliderEnabledDto,
  ) {
    return this.sliderSettingsService.setEnabled(ctx, dto.enabled);
  }
}
