import { Body, Controller, Delete, Get, Patch } from '@nestjs/common';
import { SliderSettingsService } from './slider-settings.service';
import { SetSliderCredentialsDto } from './dto/set-slider-credentials.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { TenantContext } from '../common/tenant-context';

// Same access tier as Payment Gateways / WhatsApp settings — admin only.
@Roles('admin')
@Controller('slider-settings')
export class SliderSettingsController {
  constructor(private readonly sliderSettingsService: SliderSettingsService) {}

  @Get()
  find(@CurrentUser() ctx: TenantContext) {
    return this.sliderSettingsService.find(ctx);
  }

  @Patch()
  setCredentials(
    @CurrentUser() ctx: TenantContext,
    @Body() dto: SetSliderCredentialsDto,
  ) {
    return this.sliderSettingsService.setCredentials(ctx, dto);
  }

  @Delete()
  clear(@CurrentUser() ctx: TenantContext) {
    return this.sliderSettingsService.clearCredentials(ctx);
  }
}
